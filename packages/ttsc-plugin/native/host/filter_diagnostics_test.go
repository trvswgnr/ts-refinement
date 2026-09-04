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
	for _, name := range []string{
		"validStringToTemplate",
		"validTemplateToString",
		"validStringToNumber",
		"validNumberToString",
		"validTemplateToNarrowTemplate",
		"validNarrowTemplateToTemplate",
		"validSymbol",
		"validNamedToString",
	} {
		if spans[name] {
			t.Errorf("expected diagnostic on %q to be filtered", name)
		}
	}
	for _, name := range []string{
		"invalidStringToTemplate",
		"invalidTemplateToString",
		"invalidStringToNumber",
		"invalidNumberToString",
		"invalidTemplateToNarrowTemplate",
		"invalidNarrowTemplateToTemplate",
		"invalidSymbol",
		"invalidNamedToString",
	} {
		if !spans[name] {
			t.Errorf("expected diagnostic on %q to be retained", name)
		}
	}
}

func TestFiltersOnlyValidStructuralImplications(t *testing.T) {
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
	fixtureName := filepath.Join("fixtures", "analysis", "entailment-structure-matrix.ts")
	spans := map[string]bool{}
	satisfiesDiagnostics := 0
	for _, diagnostic := range filtered {
		if !strings.HasSuffix(filepath.Clean(diagnostic.File), fixtureName) || diagnostic.Start == nil || diagnostic.Length == nil {
			continue
		}
		file := program.SourceFile(diagnostic.File)
		if file != nil && *diagnostic.Start >= 0 && *diagnostic.Start+*diagnostic.Length <= len(file.Text()) {
			spans[file.Text()[*diagnostic.Start:*diagnostic.Start+*diagnostic.Length]] = true
			if diagnostic.Code == 1360 {
				satisfiesDiagnostics++
			}
		}
	}
	for _, shape := range []string{
		"Property",
		"Optional",
		"Array",
		"Tuple",
		"OptionalTuple",
		"RestTuple",
		"Generic",
		"Union",
		"Parameter",
		"Recursive",
	} {
		if spans["valid"+shape] {
			t.Errorf("expected valid %s diagnostic to be filtered", shape)
		}
		if !spans["invalid"+shape] {
			t.Errorf("expected invalid %s diagnostic to be retained", shape)
		}
	}
	if spans["validMutableArray"] {
		t.Error("expected mutable-to-readonly array diagnostic to be filtered")
	}
	for _, name := range []string{
		"validRequiredToOptionalTuple",
		"validShortToOptionalTuple",
		"validFixedToRestTuple",
		"validSatisfies",
		"validGenericCallable",
	} {
		if spans[name] {
			t.Errorf("expected tuple subtype diagnostic on %q to be filtered", name)
		}
	}
	for _, name := range []string{
		"invalidReadonlyArray",
		"invalidOptionalRequired",
		"invalidTupleLength",
		"invalidTupleMember",
		"invalidOptionalToRequiredTuple",
		"invalidRestToFixedTuple",
		"invalidTupleExtra",
		"invalidFixedToRestMember",
		"invalidGenericCallable",
		"invalidGenericConstraint",
		"invalidGenericArity",
	} {
		if !spans[name] {
			t.Errorf("expected ordinary incompatibility on %q to be retained", name)
		}
	}
	if satisfiesDiagnostics != 1 {
		t.Errorf("expected one inverse satisfies diagnostic, got %d", satisfiesDiagnostics)
	}
	if !spans["return"] {
		t.Error("expected target type parameter return diagnostic to be retained")
	}
}
