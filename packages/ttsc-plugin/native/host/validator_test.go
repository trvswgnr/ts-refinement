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
	guard := `if (__ts_refinement_value === null || __ts_refinement_value === undefined) {`
	access := `const __ts_refinement_nested0_0 = __ts_refinement_value["age"];`
	guardIndex := strings.Index(code, guard)
	accessIndex := strings.Index(code, access)
	if guardIndex < 0 || accessIndex < 0 || guardIndex > accessIndex {
		t.Fatalf("validator does not guard before property access:\n%s", code)
	}
}
