package host

import (
	"testing"

	"github.com/ts-refinement/ttsc-plugin/native/analysis"
)

func TestMatchesIndexName(t *testing.T) {
	number := analysis.PathSegment{Kind: analysis.PathIndex, Key: "number"}
	for _, name := range []string{"-1", "1.5", "NaN", "Infinity", "-Infinity"} {
		if !matchesIndexName(number, name) {
			t.Errorf("expected number index to match %q", name)
		}
	}
	for _, name := range []string{"01", "1e3", "-0"} {
		if matchesIndexName(number, name) {
			t.Errorf("expected number index not to match %q", name)
		}
	}

	template := analysis.PathSegment{
		Kind: analysis.PathIndex,
		Key:  "template",
		Pattern: &analysis.IndexPattern{
			Placeholders: []string{"string"},
			Texts:        []string{"data-", ""},
		},
	}
	if !matchesIndexName(template, "data-ok") {
		t.Error("expected template index to match data-ok")
	}
	if matchesIndexName(template, "other") {
		t.Error("expected template index not to match other")
	}
}
