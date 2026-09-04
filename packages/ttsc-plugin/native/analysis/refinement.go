package analysis

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	shimast "github.com/microsoft/typescript-go/shim/ast"
	shimchecker "github.com/microsoft/typescript-go/shim/checker"
	shimcore "github.com/microsoft/typescript-go/shim/core"
	shimparser "github.com/microsoft/typescript-go/shim/parser"

	"github.com/ts-refinement/ttsc-plugin/native/entailment"
)

const (
	DiagnosticInvalidExpression     int32 = 1000000
	DiagnosticPredicateNotConcrete  int32 = 1000001
	DiagnosticCannotInferSubject    int32 = 1000002
	DiagnosticExternalCapture       int32 = 1000003
	DiagnosticSourceNotAssignable   int32 = 1000101
	DiagnosticStaticallyDisproven   int32 = 1000200
	DiagnosticUnableResolveMetadata int32 = 1000400
	DiagnosticPublishVerification   int32 = 1000500
)

type Issue struct {
	Code    int32
	Message string
}

type Definition struct {
	BaseTypes  []*shimchecker.Type
	Display    string
	Predicates []entailment.Predicate
	Sources    []string
}

type Resolution struct {
	Definition *Definition
	Issues     []Issue
	Refinement bool
}

func markerSymbol(checker *shimchecker.Checker, target *shimchecker.Type) *shimast.Symbol {
	for _, property := range shimchecker.Checker_getPropertiesOfType(checker, target) {
		if property != nil && canonicalMarkerSymbol(property) {
			return property
		}
	}
	return nil
}

func canonicalMarkerSymbol(symbol *shimast.Symbol) bool {
	for _, declaration := range symbol.Declarations {
		if declaration == nil || declaration.Kind != shimast.KindPropertySignature {
			continue
		}
		name := declaration.Name()
		if name == nil || name.Kind != shimast.KindComputedPropertyName {
			continue
		}
		expression := name.AsComputedPropertyName().Expression
		if expression == nil || expression.Kind != shimast.KindIdentifier || expression.Text() != "refinementBrand" {
			continue
		}
		for ancestor := declaration.Parent; ancestor != nil; ancestor = ancestor.Parent {
			if ancestor.Kind != shimast.KindTypeAliasDeclaration {
				continue
			}
			aliasName := ancestor.AsTypeAliasDeclaration().Name()
			return aliasName != nil && aliasName.Text() == "Refined" && sourcePackageName(declaration) == "ts-refinement"
		}
	}
	return false
}

func sourcePackageName(node *shimast.Node) string {
	file := shimast.GetSourceFileOfNode(node)
	if file == nil {
		return ""
	}
	directory := filepath.Dir(file.FileName())
	for {
		data, err := os.ReadFile(filepath.Join(directory, "package.json"))
		if err == nil {
			metadata := struct {
				Name string `json:"name"`
			}{}
			if json.Unmarshal(data, &metadata) == nil {
				return metadata.Name
			}
		}
		parent := filepath.Dir(directory)
		if parent == directory {
			return ""
		}
		directory = parent
	}
}

func parsePredicate(
	checker *shimchecker.Checker,
	source string,
	scope *shimast.Node,
) (entailment.Predicate, *Issue) {
	wrapped := "const __predicate = (" + source + ");"
	file := shimparser.ParseSourceFile(
		shimast.SourceFileParseOptions{FileName: "/__ts_refinement_predicate.ts"},
		wrapped,
		shimcore.ScriptKindTS,
	)
	if file == nil {
		return entailment.Predicate{}, &Issue{Code: DiagnosticInvalidExpression, Message: "TypeScript-Go could not parse the predicate"}
	}
	if scope == nil {
		predicate, err := entailment.ParsePredicate(source)
		if err != nil {
			return entailment.Predicate{}, &Issue{Code: DiagnosticInvalidExpression, Message: err.Error()}
		}
		return predicate, nil
	}
	identifiers, err := entailment.FreeIdentifiers(source)
	if err != nil {
		return entailment.Predicate{}, &Issue{Code: DiagnosticInvalidExpression, Message: err.Error()}
	}
	captures := map[string]string{}
	for _, name := range identifiers {
		symbol := checker.ResolveName(name, scope, shimast.SymbolFlagsValue, true)
		if symbol == nil {
			continue
		}
		capture, ok := immutableLiteralCapture(checker, symbol)
		if !ok {
			return entailment.Predicate{}, &Issue{
				Code:    DiagnosticExternalCapture,
				Message: fmt.Sprintf("Predicate capture '%s' must resolve to an immutable primitive literal.", name),
			}
		}
		captures[name] = capture
	}
	predicate, err := entailment.ParsePredicateWithCaptures(source, captures)
	if err != nil {
		return entailment.Predicate{}, &Issue{Code: DiagnosticInvalidExpression, Message: err.Error()}
	}
	return predicate, nil
}

func Resolve(checker *shimchecker.Checker, target *shimchecker.Type, locations ...*shimast.Node) Resolution {
	if checker == nil || target == nil {
		return Resolution{}
	}
	parts := []*shimchecker.Type{target}
	if target.Flags()&shimchecker.TypeFlagsIntersection != 0 {
		parts = target.Types()
	}
	baseTypes := make([]*shimchecker.Type, 0, len(parts))
	predicateSources := []string{}
	found := false
	for _, part := range parts {
		marker := markerSymbol(checker, part)
		if marker == nil {
			baseTypes = append(baseTypes, part)
			continue
		}
		found = true
		markerType := shimchecker.Checker_getTypeOfSymbol(checker, marker)
		if markerType == nil {
			return Resolution{
				Refinement: true,
				Issues:     []Issue{{Code: DiagnosticUnableResolveMetadata, Message: "Unable to resolve refinement marker type."}},
			}
		}
		tags := shimchecker.Checker_getPropertiesOfType(checker, markerType)
		if len(tags) == 0 {
			return Resolution{
				Refinement: true,
				Issues:     []Issue{{Code: DiagnosticPredicateNotConcrete, Message: "Refinement predicate must be a concrete string literal at the assertion site."}},
			}
		}
		for _, tag := range tags {
			if tag != nil {
				predicateSources = append(predicateSources, tag.Name)
			}
		}
	}
	if !found {
		return Resolution{}
	}
	if len(baseTypes) == 0 {
		return Resolution{
			Refinement: true,
			Issues:     []Issue{{Code: DiagnosticUnableResolveMetadata, Message: "Unable to resolve the unrefined base type."}},
		}
	}
	predicates := make([]entailment.Predicate, 0, len(predicateSources))
	var location *shimast.Node
	if len(locations) > 0 {
		location = locations[0]
	}
	scopes := predicateDeclarationScopes(checker, location)
	for _, source := range predicateSources {
		predicate, issue := parsePredicate(checker, source, scopes[source])
		if issue != nil {
			return Resolution{
				Refinement: true,
				Issues:     []Issue{*issue},
			}
		}
		predicates = append(predicates, predicate)
	}
	return Resolution{
		Refinement: true,
		Definition: &Definition{
			BaseTypes:  baseTypes,
			Display:    checker.TypeToString(target),
			Predicates: predicates,
			Sources:    predicateSources,
		},
	}
}

func predicateDeclarationScopes(checker *shimchecker.Checker, root *shimast.Node) map[string]*shimast.Node {
	scopes := map[string]*shimast.Node{}
	if checker == nil || root == nil {
		return scopes
	}
	visitedDeclarations := map[*shimast.Node]struct{}{}
	visitedSymbols := map[*shimast.Symbol]struct{}{}
	var visit func(*shimast.Node)
	visitSymbol := func(symbol *shimast.Symbol) {}
	visitSymbol = func(symbol *shimast.Symbol) {
		if symbol == nil {
			return
		}
		if symbol.Flags&shimast.SymbolFlagsAlias != 0 {
			symbol = shimchecker.Checker_getAliasedSymbol(checker, symbol)
		}
		if symbol == nil {
			return
		}
		if _, seen := visitedSymbols[symbol]; seen {
			return
		}
		visitedSymbols[symbol] = struct{}{}
		for _, declaration := range symbol.Declarations {
			if _, seen := visitedDeclarations[declaration]; seen {
				continue
			}
			visitedDeclarations[declaration] = struct{}{}
			visit(declaration)
		}
	}
	visit = func(node *shimast.Node) {
		if node == nil {
			return
		}
		if node.Kind == shimast.KindTypeReference {
			reference := node.AsTypeReferenceNode()
			symbol := checker.GetSymbolAtLocation(reference.TypeName)
			target := symbol
			if target != nil && target.Flags&shimast.SymbolFlagsAlias != 0 {
				target = shimchecker.Checker_getAliasedSymbol(checker, target)
			}
			if target != nil && target.Name == "Refined" && reference.TypeArguments != nil && len(reference.TypeArguments.Nodes) > 1 {
				predicateType := reference.TypeArguments.Nodes[1]
				if predicateType.Kind == shimast.KindLiteralType {
					literal := predicateType.AsLiteralTypeNode().Literal
					if literal != nil && (literal.Kind == shimast.KindStringLiteral || literal.Kind == shimast.KindNoSubstitutionTemplateLiteral) {
						scopes[literal.Text()] = literal
					}
				}
			}
			visitSymbol(symbol)
		}
		node.ForEachChild(func(child *shimast.Node) bool {
			visit(child)
			return false
		})
	}
	visit(root)
	return scopes
}

func immutableLiteralCapture(checker *shimchecker.Checker, symbol *shimast.Symbol) (string, bool) {
	if symbol.Flags&shimast.SymbolFlagsAlias != 0 {
		symbol = shimchecker.Checker_getAliasedSymbol(checker, symbol)
	}
	if symbol == nil {
		return "", false
	}
	for _, declaration := range symbol.Declarations {
		if declaration.Kind != shimast.KindVariableDeclaration || !shimast.IsConst(declaration) ||
			declaration.Parent == nil || declaration.Parent.Kind != shimast.KindVariableDeclarationList ||
			declaration.Parent.Parent == nil || declaration.Parent.Parent.Kind != shimast.KindVariableStatement ||
			declaration.Parent.Parent.Parent == nil || declaration.Parent.Parent.Parent.Kind != shimast.KindSourceFile {
			continue
		}
		initializer := unwrapLiteralInitializer(declaration.Initializer())
		if initializer == nil {
			return "", false
		}
		typeAtDeclaration := shimchecker.Checker_getTypeOfSymbolAtLocation(checker, symbol, declaration.Name())
		if !isPrimitiveLiteralType(typeAtDeclaration) {
			return "", false
		}
		return entailment.LiteralCaptureSource(shimast.NodeText(initializer))
	}
	return "", false
}

func unwrapLiteralInitializer(node *shimast.Node) *shimast.Node {
	for node != nil {
		switch node.Kind {
		case shimast.KindParenthesizedExpression, shimast.KindAsExpression,
			shimast.KindTypeAssertionExpression, shimast.KindSatisfiesExpression:
			node = node.Expression()
		default:
			return node
		}
	}
	return nil
}

func isPrimitiveLiteralType(target *shimchecker.Type) bool {
	if target == nil {
		return false
	}
	return target.Flags()&(shimchecker.TypeFlagsStringLiteral|shimchecker.TypeFlagsNumberLiteral|
		shimchecker.TypeFlagsBigIntLiteral|shimchecker.TypeFlagsBooleanLiteral|shimchecker.TypeFlagsNull) != 0
}

func BasesAssignable(checker *shimchecker.Checker, source, target *Definition) bool {
	if checker == nil || source == nil || target == nil {
		return false
	}
	for _, targetBase := range target.BaseTypes {
		assignable := false
		for _, sourceBase := range source.BaseTypes {
			if checker.IsTypeAssignableTo(sourceBase, targetBase) {
				assignable = true
				break
			}
		}
		if !assignable {
			return false
		}
	}
	return true
}

func DefinitionEntails(checker *shimchecker.Checker, source, target *Definition) bool {
	if !BasesAssignable(checker, source, target) {
		return false
	}
	facts := entailment.Facts{}
	for _, base := range target.BaseTypes {
		if base.Flags()&shimchecker.TypeFlagsStringLike != 0 || shimchecker.Checker_isArrayType(checker, base) {
			facts.SubjectLength = true
		}
	}
	return entailment.Entails(source.Predicates, target.Predicates, facts)
}

func CompileCondition(definition *Definition, subject string) string {
	conditions := make([]string, len(definition.Predicates))
	for index, predicate := range definition.Predicates {
		conditions[index] = entailment.Compile(predicate, subject)
	}
	if len(conditions) == 0 {
		return "true"
	}
	return strings.Join(conditions, " && ")
}
