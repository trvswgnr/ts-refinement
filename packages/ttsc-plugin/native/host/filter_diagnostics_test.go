package host

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/samchon/ttsc/packages/ttsc/driver"
)

func TestFiltersEntailedRefinementTransfers(t *testing.T) {
	repositoryRoot, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	program, parseDiagnostics, err := driver.LoadProgram(
		repositoryRoot,
		filepath.Join(repositoryRoot, "fixtures/ttsc/valid/tsconfig.json"),
		driver.LoadProgramOptions{ForceNoEmit: true},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(parseDiagnostics) > 0 {
		t.Fatalf("unexpected parse diagnostics: %#v", parseDiagnostics)
	}
	defer program.Close()

	diagnostics := program.Diagnostics()
	filtered := filterEntailedRefinementDiagnostics(program.Checker, program.SourceFiles(), diagnostics)
	if len(filtered) == 0 {
		return
	}
	for _, diagnostic := range filtered {
		if diagnostic.Start == nil || diagnostic.Length == nil {
			t.Logf("retained TS%d without a span: %s", diagnostic.Code, diagnostic.Message)
			continue
		}
		file := program.SourceFile(diagnostic.File)
		text := ""
		if file != nil && *diagnostic.Start >= 0 && *diagnostic.Start+*diagnostic.Length <= len(file.Text()) {
			text = file.Text()[*diagnostic.Start : *diagnostic.Start+*diagnostic.Length]
		}
		transfers := findTransfers(program.Checker, file, diagnostic.Code, *diagnostic.Start, *diagnostic.Length)
		t.Logf("retained TS%d span %q with %d transfer(s)", diagnostic.Code, text, len(transfers))
	}
	t.Fatalf("retained %d of %d refinement transfer diagnostics", len(filtered), len(diagnostics))
}

func TestRetainsUnprovenRefinementTransfers(t *testing.T) {
	repositoryRoot, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	program, parseDiagnostics, err := driver.LoadProgram(
		repositoryRoot,
		filepath.Join(repositoryRoot, "fixtures/analysis/tsconfig.json"),
		driver.LoadProgramOptions{ForceNoEmit: true},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(parseDiagnostics) > 0 {
		t.Fatalf("unexpected parse diagnostics: %#v", parseDiagnostics)
	}
	defer program.Close()

	filtered := filterEntailedRefinementDiagnostics(program.Checker, program.SourceFiles(), program.Diagnostics())
	fixtureName := filepath.Join("fixtures", "analysis", "entailment-diagnostics.ts")
	spans := map[string]bool{}
	for _, diagnostic := range filtered {
		if !strings.HasSuffix(filepath.Clean(diagnostic.File), fixtureName) || diagnostic.Start == nil || diagnostic.Length == nil {
			continue
		}
		file := program.SourceFile(diagnostic.File)
		if file != nil && *diagnostic.Start >= 0 && *diagnostic.Start+*diagnostic.Length <= len(file.Text()) {
			spans[file.Text()[*diagnostic.Start:*diagnostic.Start+*diagnostic.Length]] = true
		}
	}
	for _, retained := range []string{
		"inverseAssignment",
		"unsupportedAssignment",
		"incompatibleBaseAssignment",
		"nonRefinementMismatch",
		"unrelatedDiagnostic",
		"unavailableName",
	} {
		if !spans[retained] {
			t.Errorf("expected diagnostic on %q to be retained", retained)
		}
	}
	for _, removed := range []string{"entailedAssignment", "normalizedSubjectAssignment"} {
		if spans[removed] {
			t.Errorf("expected diagnostic on %q to be filtered", removed)
		}
	}
}

func TestComparesSourceAndTargetIndexDomains(t *testing.T) {
	repositoryRoot, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	program, parseDiagnostics, err := driver.LoadProgram(
		repositoryRoot,
		filepath.Join(repositoryRoot, "fixtures/analysis/tsconfig.json"),
		driver.LoadProgramOptions{ForceNoEmit: true},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(parseDiagnostics) > 0 {
		t.Fatalf("unexpected parse diagnostics: %#v", parseDiagnostics)
	}
	defer program.Close()

	filtered := filterEntailedRefinementDiagnostics(program.Checker, program.SourceFiles(), program.Diagnostics())
	fixtureName := filepath.Join("fixtures", "analysis", "entailment-index-domains.ts")
	spans := map[string]bool{}
	for _, diagnostic := range filtered {
		if !strings.HasSuffix(filepath.Clean(diagnostic.File), fixtureName) || diagnostic.Start == nil || diagnostic.Length == nil {
			continue
		}
		file := program.SourceFile(diagnostic.File)
		if file != nil && *diagnostic.Start >= 0 && *diagnostic.Start+*diagnostic.Length <= len(file.Text()) {
			spans[file.Text()[*diagnostic.Start:*diagnostic.Start+*diagnostic.Length]] = true
		}
	}
	if spans["validTemplateTarget"] {
		t.Error("expected entailed template target diagnostic to be filtered")
	}
	if !spans["invalidTemplateTarget"] {
		t.Error("expected stronger template target diagnostic to be retained")
	}
}
