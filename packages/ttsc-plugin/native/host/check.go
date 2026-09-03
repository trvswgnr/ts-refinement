package host

import (
	"fmt"
	"os"
	"strings"

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
	refinementDiagnostics := collectProjectRefinementDiagnostics(program)
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

func collectProjectRefinementDiagnostics(program *driver.Program) []protocolDiagnostic {
	if program == nil || program.Checker == nil || program.TSProgram == nil {
		return nil
	}
	diagnostics := []protocolDiagnostic{}
	seen := map[string]struct{}{}
	for _, file := range program.SourceFiles() {
		if program.TSProgram.IsSourceFileFromExternalLibrary(file) {
			continue
		}
		source := file.Text()
		if canContainRefinementDefinition(source) {
			diagnostics = appendUniqueDiagnostics(diagnostics, seen, refinementDefinitionDiagnostics(program.Checker, file))
		}
		if refinementAssertionPattern.MatchString(source) {
			_, assertions := transformFile(program.Checker, file)
			diagnostics = appendUniqueDiagnostics(diagnostics, seen, assertions)
		}
	}
	return diagnostics
}

func canContainRefinementDefinition(source string) bool {
	return strings.Contains(source, "ts-refinement")
}

func appendUniqueDiagnostics(
	target []protocolDiagnostic,
	seen map[string]struct{},
	candidates []protocolDiagnostic,
) []protocolDiagnostic {
	for _, diagnostic := range candidates {
		key := protocolDiagnosticKey(diagnostic)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		target = append(target, diagnostic)
	}
	return target
}

func protocolDiagnosticKey(diagnostic protocolDiagnostic) string {
	file := ""
	if diagnostic.File != nil {
		file = *diagnostic.File
	}
	start := -1
	if diagnostic.Start != nil {
		start = *diagnostic.Start
	}
	length := -1
	if diagnostic.Length != nil {
		length = *diagnostic.Length
	}
	return fmt.Sprintf("%s:%d:%d:%v:%s", file, start, length, diagnostic.Code, diagnostic.MessageText)
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
