package analysis

import (
	"encoding/json"
	"fmt"
	"strings"

	shimast "github.com/microsoft/typescript-go/shim/ast"
	shimchecker "github.com/microsoft/typescript-go/shim/checker"
)

const (
	PathArray     = "array"
	PathIndex     = "index"
	PathProperty  = "property"
	PathTuple     = "tuple"
	PathTupleRest = "tupleRest"
	PathUnion     = "union"
)

type PathSegment struct {
	Kind     string
	Key      string
	Pattern  *IndexPattern
	Name     string
	Optional bool
	Index    int
	Start    int
	Property string
	Value    any
}

type IndexPattern struct {
	Placeholders []string
	Texts        []string
}

type Check struct {
	Definition *Definition
	Path       []PathSegment
}

type Recursion struct {
	Path       []PathSegment
	TargetPath []PathSegment
}

type ChecksResolution struct {
	Checks     []Check
	Issues     []Issue
	Recursions []Recursion
}

type unionBranch struct {
	property string
	target   *shimchecker.Type
	value    any
}

func ResolveChecks(checker *shimchecker.Checker, targetType *shimchecker.Type, locations ...*shimast.Node) ChecksResolution {
	result := ChecksResolution{}
	activeTypes := map[*shimchecker.Type][]PathSegment{}

	var visit func(*shimchecker.Type, []PathSegment)
	visit = func(target *shimchecker.Type, path []PathSegment) {
		if target == nil {
			return
		}
		if targetPath, recursive := activeTypes[target]; recursive {
			result.Recursions = append(result.Recursions, Recursion{
				Path:       clonePath(path),
				TargetPath: clonePath(targetPath),
			})
			return
		}
		activeTypes[target] = clonePath(path)
		defer delete(activeTypes, target)

		resolution := Resolve(checker, target, locations...)
		if resolution.Refinement {
			result.Issues = append(result.Issues, resolution.Issues...)
			if resolution.Definition != nil {
				result.Checks = append(result.Checks, Check{Definition: resolution.Definition, Path: clonePath(path)})
				for _, base := range resolution.Definition.BaseTypes {
					visit(base, path)
				}
			}
			return
		}

		if target.Flags()&shimchecker.TypeFlagsTypeParameter != 0 {
			visit(checker.GetBaseConstraintOfType(target), path)
			return
		}

		if target.Flags()&shimchecker.TypeFlagsUnion != 0 {
			defined := []*shimchecker.Type{}
			for _, part := range target.Types() {
				if part.Flags()&shimchecker.TypeFlagsUndefined == 0 {
					defined = append(defined, part)
				}
			}
			if len(defined) == 1 {
				visit(defined[0], path)
				return
			}
			if discriminant := unionDiscriminant(checker, target); discriminant != nil {
				for _, branch := range discriminant {
					visit(branch.target, appendPath(path, PathSegment{
						Kind: PathUnion, Property: branch.property, Value: branch.value,
					}))
				}
				return
			}

			branchChecks := make([][]Check, 0, len(target.Types()))
			for _, branch := range target.Types() {
				start := len(result.Checks)
				visit(branch, path)
				checks := append([]Check(nil), result.Checks[start:]...)
				result.Checks = result.Checks[:start]
				branchChecks = append(branchChecks, checks)
			}
			if equivalentCheckBranches(branchChecks) {
				if len(branchChecks) > 0 {
					result.Checks = append(result.Checks, branchChecks[0]...)
				}
			} else if branchesContainChecks(branchChecks) {
				result.Issues = append(result.Issues, Issue{
					Code:    DiagnosticUnableResolveMetadata,
					Message: "A union containing refinements requires a unique literal discriminant.",
				})
			}
			return
		}

		if shimchecker.IsTupleType(target) {
			typeArguments := shimchecker.Checker_getTypeArguments(checker, target)
			flags := target.TargetTupleType().ElementFlags()
			for index, elementType := range typeArguments {
				elementFlags := shimchecker.ElementFlagsRequired
				if index < len(flags) {
					elementFlags = flags[index]
				}
				if elementFlags&(shimchecker.ElementFlagsRest|shimchecker.ElementFlagsVariadic) != 0 {
					visit(elementType, appendPath(path, PathSegment{Kind: PathTupleRest, Start: index}))
				} else {
					visit(elementType, appendPath(path, PathSegment{
						Kind: PathTuple, Index: index, Optional: elementFlags&shimchecker.ElementFlagsOptional != 0,
					}))
				}
			}
			return
		}

		if elementType := arrayElementType(checker, target); elementType != nil {
			visit(elementType, appendPath(path, PathSegment{Kind: PathArray}))
			return
		}

		if target.Flags()&shimchecker.TypeFlagsObject == 0 ||
			len(shimchecker.Checker_getSignaturesOfType(checker, target, shimchecker.SignatureKindCall)) > 0 {
			return
		}
		for _, property := range shimchecker.Checker_getPropertiesOfType(checker, target) {
			if property == nil || strings.HasPrefix(property.Name, "__@") || strings.HasPrefix(property.Name, "\xfe") {
				continue
			}
			childType := propertyType(checker, target, property.Name)
			if childType == nil {
				continue
			}
			optional := property.Flags&shimast.SymbolFlagsOptional != 0 || includesUndefined(childType)
			visit(withoutUndefined(childType), appendPath(path, PathSegment{
				Kind: PathProperty, Name: property.Name, Optional: optional,
			}))
		}
		for _, index := range shimchecker.Checker_getIndexInfosOfType(checker, target) {
			segment, ok := indexPathSegment(index.KeyType())
			if !ok {
				result.Issues = append(result.Issues, Issue{
					Code:    DiagnosticUnableResolveMetadata,
					Message: fmt.Sprintf("Index signature key type '%s' cannot be validated at runtime.", checker.TypeToString(index.KeyType())),
				})
				continue
			}
			visit(index.ValueType(), appendPath(path, segment))
		}
	}

	visit(targetType, nil)
	return result
}

func indexPathSegment(keyType *shimchecker.Type) (PathSegment, bool) {
	switch {
	case keyType.Flags()&shimchecker.TypeFlagsNumberLike != 0:
		return PathSegment{Kind: PathIndex, Key: "number"}, true
	case keyType.Flags()&shimchecker.TypeFlagsESSymbolLike != 0:
		return PathSegment{Kind: PathIndex, Key: "symbol"}, true
	case keyType.Flags()&shimchecker.TypeFlagsTemplateLiteral != 0:
		template := keyType.AsTemplateLiteralType()
		placeholders := make([]string, len(template.Types()))
		for index, placeholderType := range template.Types() {
			placeholder, ok := templateIndexPlaceholder(placeholderType)
			if !ok {
				return PathSegment{}, false
			}
			placeholders[index] = placeholder
		}
		return PathSegment{
			Kind: PathIndex,
			Key:  "template",
			Pattern: &IndexPattern{
				Placeholders: placeholders,
				Texts:        append([]string(nil), template.Texts()...),
			},
		}, true
	case keyType.Flags()&shimchecker.TypeFlagsStringLike != 0:
		return PathSegment{Kind: PathIndex, Key: "string"}, true
	default:
		return PathSegment{}, false
	}
}

func templateIndexPlaceholder(target *shimchecker.Type) (string, bool) {
	switch {
	case target.Flags()&(shimchecker.TypeFlagsAny|shimchecker.TypeFlagsString) != 0:
		return "string", true
	case target.Flags()&shimchecker.TypeFlagsNumber != 0:
		return "number", true
	case target.Flags()&shimchecker.TypeFlagsBigInt != 0:
		return "bigint", true
	default:
		return "", false
	}
}

func arrayElementType(checker *shimchecker.Checker, target *shimchecker.Type) *shimchecker.Type {
	symbol := target.Symbol()
	if !shimchecker.Checker_isArrayType(checker, target) &&
		(symbol == nil || (symbol.Name != "Array" && symbol.Name != "ReadonlyArray")) {
		return nil
	}
	arguments := shimchecker.Checker_getTypeArguments(checker, target)
	if len(arguments) == 0 {
		return nil
	}
	return arguments[0]
}

func propertyType(checker *shimchecker.Checker, target *shimchecker.Type, name string) *shimchecker.Type {
	return shimchecker.Checker_getTypeOfPropertyOfType(checker, target, name)
}

func includesUndefined(target *shimchecker.Type) bool {
	if target == nil || target.Flags()&shimchecker.TypeFlagsUnion == 0 {
		return false
	}
	for _, part := range target.Types() {
		if part.Flags()&shimchecker.TypeFlagsUndefined != 0 {
			return true
		}
	}
	return false
}

func withoutUndefined(target *shimchecker.Type) *shimchecker.Type {
	if !includesUndefined(target) {
		return target
	}
	defined := []*shimchecker.Type{}
	for _, part := range target.Types() {
		if part.Flags()&shimchecker.TypeFlagsUndefined == 0 {
			defined = append(defined, part)
		}
	}
	if len(defined) == 1 {
		return defined[0]
	}
	return target
}

func unionDiscriminant(checker *shimchecker.Checker, target *shimchecker.Type) []unionBranch {
	for _, property := range shimchecker.Checker_getPropertiesOfType(checker, target) {
		if property == nil {
			continue
		}
		branches := make([]unionBranch, 0, len(target.Types()))
		values := map[string]struct{}{}
		valid := true
		for _, part := range target.Types() {
			value, ok := discriminantValue(checker, propertyType(checker, part, property.Name))
			if !ok {
				valid = false
				break
			}
			encoded, _ := json.Marshal(value)
			key := string(encoded)
			if _, duplicate := values[key]; duplicate {
				valid = false
				break
			}
			values[key] = struct{}{}
			branches = append(branches, unionBranch{property: property.Name, target: part, value: value})
		}
		if valid {
			return branches
		}
	}
	return nil
}

func discriminantValue(checker *shimchecker.Checker, target *shimchecker.Type) (any, bool) {
	if target == nil {
		return nil, false
	}
	switch {
	case target.Flags()&shimchecker.TypeFlagsStringLiteral != 0:
		return target.AsLiteralType().Value(), true
	case target.Flags()&shimchecker.TypeFlagsNumberLiteral != 0:
		return target.AsLiteralType().Value(), true
	case target.Flags()&shimchecker.TypeFlagsBooleanLiteral != 0:
		return checker.TypeToString(target) == "true", true
	case target.Flags()&shimchecker.TypeFlagsNull != 0:
		return nil, true
	default:
		return nil, false
	}
}

func equivalentCheckBranches(branches [][]Check) bool {
	if len(branches) == 0 {
		return true
	}
	first := checkKeys(branches[0])
	for _, branch := range branches[1:] {
		keys := checkKeys(branch)
		if len(keys) != len(first) {
			return false
		}
		for index := range keys {
			if keys[index] != first[index] {
				return false
			}
		}
	}
	return true
}

func checkKeys(checks []Check) []string {
	keys := make([]string, len(checks))
	for index, check := range checks {
		path, _ := json.Marshal(check.Path)
		sources := make([]string, len(check.Definition.Predicates))
		for predicateIndex, predicate := range check.Definition.Predicates {
			sources[predicateIndex] = predicate.Source
		}
		keys[index] = string(path) + strings.Join(sources, "\x00")
	}
	return keys
}

func branchesContainChecks(branches [][]Check) bool {
	for _, branch := range branches {
		if len(branch) > 0 {
			return true
		}
	}
	return false
}

func appendPath(path []PathSegment, segment PathSegment) []PathSegment {
	result := clonePath(path)
	return append(result, segment)
}

func clonePath(path []PathSegment) []PathSegment {
	return append([]PathSegment(nil), path...)
}
