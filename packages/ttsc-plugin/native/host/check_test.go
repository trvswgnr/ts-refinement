package host

import "testing"

func TestAppendUniqueDiagnostics(t *testing.T) {
	file := "/project/index.ts"
	start := 12
	length := 8
	diagnostic := protocolDiagnostic{
		File:        &file,
		Code:        "RF90000",
		Start:       &start,
		Length:      &length,
		MessageText: "Invalid refinement JavaScript expression.",
	}
	seen := map[string]struct{}{}
	result := appendUniqueDiagnostics(nil, seen, []protocolDiagnostic{diagnostic, diagnostic})
	if len(result) != 1 {
		t.Fatalf("got %d diagnostics, want 1", len(result))
	}
}

func TestNativeCheckSourcePrefilters(t *testing.T) {
	for _, source := range []string{
		`import type { Refined } from "ts-refinement";`,
		`import type { Refined as R } from 'ts-refinement';`,
	} {
		if !canContainRefinementDefinition(source) {
			t.Errorf("expected refinement definition candidate in %q", source)
		}
	}
	for _, source := range []string{
		"export const value = 1",
		"interface Example { value: number }",
	} {
		if canContainRefinementDefinition(source) {
			t.Errorf("expected irrelevant source in %q", source)
		}
	}
}
