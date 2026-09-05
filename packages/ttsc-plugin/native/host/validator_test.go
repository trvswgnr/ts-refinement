package host

import (
	"strings"
	"testing"

	"github.com/ts-refinement/ttsc-plugin/native/analysis"
	"github.com/ts-refinement/ttsc-plugin/native/entailment"
)

func TestValidatorGuardsNullishNestedValues(t *testing.T) {
	predicate, err := entailment.ParsePredicate("value > 0")
	if err != nil {
		t.Fatal(err)
	}
	code := emitValidator(
		[]analysis.Check{{
			Definition: &analysis.Definition{Display: "Positive", Predicates: []entailment.Predicate{predicate}},
			Path:       []analysis.PathSegment{{Kind: analysis.PathProperty, Name: "age"}},
		}},
		nil,
		"RefinementError",
		"",
	)
	guard := `if (__ts_refinement_value === null || __ts_refinement_value === undefined || (typeof __ts_refinement_value !== "object" && typeof __ts_refinement_value !== "function")) {`
	access := `const __ts_refinement_nested0_0 = __ts_refinement_value["age"];`
	guardIndex := strings.Index(code, guard)
	accessIndex := strings.Index(code, access)
	if guardIndex < 0 || accessIndex < 0 || guardIndex > accessIndex {
		t.Fatalf("validator does not guard before property access:\n%s", code)
	}
}

func TestValidatorGuardsArrayTraversals(t *testing.T) {
	predicate, err := entailment.ParsePredicate("value > 0")
	if err != nil {
		t.Fatal(err)
	}
	check := analysis.Check{
		Definition: &analysis.Definition{Display: "Positive", Predicates: []entailment.Predicate{predicate}},
		Path:       []analysis.PathSegment{{Kind: analysis.PathArray}},
	}
	code := emitValidator([]analysis.Check{check}, nil, "RefinementError", "")
	guard := `!Array.isArray(__ts_refinement_value)`
	loop := `< __ts_refinement_value.length`
	guardIndex := strings.Index(code, guard)
	loopIndex := strings.Index(code, loop)
	if guardIndex < 0 || loopIndex < 0 || guardIndex > loopIndex {
		t.Fatalf("validator does not guard array traversal:\n%s", code)
	}

	recursive := emitValidator(
		[]analysis.Check{{
			Definition: check.Definition,
			Path:       []analysis.PathSegment{{Kind: analysis.PathProperty, Name: "value"}},
		}},
		[]analysis.Recursion{{
			Path: []analysis.PathSegment{
				{Kind: analysis.PathProperty, Name: "children"},
				{Kind: analysis.PathArray},
			},
		}},
		"RefinementError",
		"",
	)
	if !strings.Contains(recursive, "!Array.isArray(__ts_refinement_nested0_r0_0)") {
		t.Fatalf("recursive validator does not guard child array traversal:\n%s", recursive)
	}
}

func TestValidatorGuardsIndexTraversals(t *testing.T) {
	predicate, err := entailment.ParsePredicate("value > 0")
	if err != nil {
		t.Fatal(err)
	}
	code := emitValidator(
		[]analysis.Check{{
			Definition: &analysis.Definition{Display: "Positive", Predicates: []entailment.Predicate{predicate}},
			Path:       []analysis.PathSegment{{Kind: analysis.PathIndex, Key: "string"}},
		}},
		nil,
		"RefinementError",
		"",
	)
	guard := `typeof __ts_refinement_value !== "object"`
	access := `Reflect.ownKeys(__ts_refinement_value)`
	guardIndex := strings.Index(code, guard)
	accessIndex := strings.Index(code, access)
	if guardIndex < 0 || accessIndex < 0 || guardIndex > accessIndex {
		t.Fatalf("validator does not guard index traversal:\n%s", code)
	}
}

func TestTemplateKeyGuardEscapesLineTerminators(t *testing.T) {
	pattern := &analysis.IndexPattern{
		Placeholders: []string{"string"},
		Texts:        []string{"line\r\n\u2028\u2029", ""},
	}
	code := strings.Join(templateKeyGuard(pattern, "key", "match", ""), "\n")
	if strings.ContainsAny(code, "\r\u2028\u2029") || strings.Count(code, "\n") != 2 {
		t.Fatalf("validator contains a raw line terminator:\n%s", code)
	}
	if !strings.Contains(code, `const match = /^line\r\n\u2028\u2029([\s\S]*?)$/u.exec(key);`) {
		t.Fatalf("validator does not escape line terminators:\n%s", code)
	}
}
