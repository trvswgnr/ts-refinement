package host

import (
	"fmt"
	"os"
	"path/filepath"

	shimast "github.com/microsoft/typescript-go/shim/ast"
	shimchecker "github.com/microsoft/typescript-go/shim/checker"
	"github.com/samchon/ttsc/packages/ttsc/driver"

	"github.com/ts-refinement/ttsc-plugin/native/analysis"
)

func RunCheck(args []string) int {
	options, err := parseOptions("check", args)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	program, diagnostics, err := driver.LoadProgram(options.cwd, options.tsconfig, driver.LoadProgramOptions{
		ForceNoEmit: true,
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	if len(diagnostics) > 0 {
		driver.WritePrettyDiagnostics(os.Stderr, diagnostics, options.cwd)
		return 2
	}
	defer program.Close()

	typeScriptDiagnostics := filterEntailedRefinementDiagnostics(
		program.Checker,
		program.SourceFiles(),
		program.Diagnostics(),
	)
	refinementDiagnostics := collectRootRefinementDiagnostics(program)
	if len(typeScriptDiagnostics) > 0 {
		driver.WritePrettyDiagnostics(os.Stderr, typeScriptDiagnostics, options.cwd)
	}
	if len(refinementDiagnostics) > 0 {
		writeProtocolDiagnostics(os.Stderr, refinementDiagnostics)
	}
	if driver.CountErrors(typeScriptDiagnostics) > 0 || len(refinementDiagnostics) > 0 {
		return 2
	}
	return 0
}

func collectRootRefinementDiagnostics(program *driver.Program) []protocolDiagnostic {
	if program == nil || program.Checker == nil || program.ParsedConfig == nil {
		return nil
	}
	rootFiles := map[string]struct{}{}
	for _, fileName := range program.ParsedConfig.FileNames() {
		rootFiles[filepath.Clean(fileName)] = struct{}{}
	}
	diagnostics := []protocolDiagnostic{}
	for _, file := range program.SourceFiles() {
		if _, ok := rootFiles[filepath.Clean(file.FileName())]; !ok {
			continue
		}
		diagnostics = append(diagnostics, refinementDefinitionDiagnostics(program.Checker, file)...)
		_, assertions := transformFile(program.Checker, file)
		diagnostics = append(diagnostics, assertions...)
	}
	return diagnostics
}

func refinementDefinitionDiagnostics(checker *shimchecker.Checker, file *shimast.SourceFile) []protocolDiagnostic {
	diagnostics := []protocolDiagnostic{}
	seen := map[string]struct{}{}
	var visit func(*shimast.Node)
	visit = func(node *shimast.Node) {
		if node == nil {
			return
		}
		if node.Kind == shimast.KindTypeReference {
			resolution := analysis.Resolve(checker, checker.GetTypeAtLocation(node), node)
			for _, issue := range resolution.Issues {
				key := fmt.Sprintf("%d:%d:%s", node.Pos(), issue.Code, issue.Message)
				if _, exists := seen[key]; !exists {
					seen[key] = struct{}{}
					diagnostics = append(diagnostics, nodeDiagnostic(file, node, issue.Code, issue.Message))
				}
			}
		}
		node.ForEachChild(func(child *shimast.Node) bool {
			visit(child)
			return false
		})
	}
	visit(file.AsNode())
	return diagnostics
}
