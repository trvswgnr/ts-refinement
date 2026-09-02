package analysis

import (
	"fmt"
	"strings"

	shimast "github.com/microsoft/typescript-go/shim/ast"
	shimchecker "github.com/microsoft/typescript-go/shim/checker"
	shimcore "github.com/microsoft/typescript-go/shim/core"
	shimparser "github.com/microsoft/typescript-go/shim/parser"

	"github.com/ts-refinement/ttsc-plugin/native/entailment"
)

const (
	DiagnosticInvalidExpression     int32 = 90000
	DiagnosticPredicateNotConcrete  int32 = 90001
	DiagnosticCannotInferSubject    int32 = 90002
	DiagnosticSourceNotAssignable   int32 = 90101
	DiagnosticStaticallyDisproven   int32 = 90200
	DiagnosticUnableResolveMetadata int32 = 90400
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
		if property != nil && strings.Contains(property.Name, "refinementBrand") {
			return property
		}
	}
	return nil
}

func parsePredicate(source string) (entailment.Predicate, error) {
	wrapped := "const __predicate = (" + source + ");"
	file := shimparser.ParseSourceFile(
		shimast.SourceFileParseOptions{FileName: "/__ts_refinement_predicate.ts"},
		wrapped,
		shimcore.ScriptKindTS,
	)
	if file == nil {
		return entailment.Predicate{}, fmt.Errorf("TypeScript-Go could not parse the predicate")
	}
	return entailment.ParsePredicate(source)
}

func Resolve(checker *shimchecker.Checker, target *shimchecker.Type) Resolution {
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
	for _, source := range predicateSources {
		predicate, err := parsePredicate(source)
		if err != nil {
			return Resolution{
				Refinement: true,
				Issues:     []Issue{{Code: DiagnosticInvalidExpression, Message: err.Error()}},
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
