package host

import (
	"path/filepath"
	"strings"
	"testing"

	shimast "github.com/microsoft/typescript-go/shim/ast"
	"github.com/samchon/ttsc/packages/ttsc/driver"

	"github.com/ts-refinement/ttsc-plugin/native/analysis"
)

func TestRefinementAssertionPrefilter(t *testing.T) {
	for _, source := range []string{
		"const value = input as Positive",
		"const value = input\nas\nPositive",
		"const value = <Positive>input",
	} {
		if !refinementAssertionPattern.MatchString(source) {
			t.Errorf("expected assertion candidate in %q", source)
		}
	}

	for _, source := range []string{
		"export const value = 1",
		"export function identity(value: number): number { return value }",
		"interface Example { value: number }",
	} {
		if refinementAssertionPattern.MatchString(source) {
			t.Errorf("expected assertion-free source in %q", source)
		}
	}
}

func TestTransformsMappedIndexRefinements(t *testing.T) {
	repositoryRoot, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	program, parseDiagnostics, err := driver.LoadProgram(
		repositoryRoot,
		filepath.Join(repositoryRoot, "fixtures/ttsc/runtime/tsconfig.json"),
		driver.LoadProgramOptions{ForceNoEmit: true},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(parseDiagnostics) > 0 {
		t.Fatalf("unexpected parse diagnostics: %#v", parseDiagnostics)
	}
	defer program.Close()
	fileName := filepath.Join(repositoryRoot, "fixtures/ttsc/runtime/index.ts")
	file := program.SourceFile(fileName)
	transformed, diagnostics := transformFile(program.Checker, file)
	if len(diagnostics) > 0 {
		t.Fatalf("unexpected transform diagnostics: %#v", diagnostics)
	}
	if strings.Contains(transformed, "Reflect.ownKeys") {
		return
	}

	details := []string{}
	var visit func(*shimast.Node)
	visit = func(node *shimast.Node) {
		if site, ok := assertionAt(node); ok && strings.Contains(nodeText(file, site.node), "Scores") {
			target := program.Checker.GetTypeAtLocation(site.typeNode)
			checks := analysis.ResolveChecks(program.Checker, target, site.typeNode)
			proven, issue := proveNestedChecks(file, site, checks.Checks)
			details = append(details, strings.Join([]string{
				program.Checker.TypeToString(target),
				"checks=" + string(rune(len(checks.Checks)+'0')),
				"proven=" + map[bool]string{true: "true", false: "false"}[proven],
				"issue=" + map[bool]string{true: "yes", false: "no"}[issue != nil],
			}, " "))
		}
		node.ForEachChild(func(child *shimast.Node) bool {
			visit(child)
			return false
		})
	}
	visit(file.AsNode())
	t.Fatalf("mapped index refinement was not transformed: %s\n%s", strings.Join(details, "; "), transformed)
}
