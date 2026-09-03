package host

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	shimast "github.com/microsoft/typescript-go/shim/ast"
	shimchecker "github.com/microsoft/typescript-go/shim/checker"
	shimcompiler "github.com/microsoft/typescript-go/shim/compiler"
	shimcore "github.com/microsoft/typescript-go/shim/core"
	shimparser "github.com/microsoft/typescript-go/shim/parser"
	shimprinter "github.com/microsoft/typescript-go/shim/printer"
	shimscanner "github.com/microsoft/typescript-go/shim/scanner"
	"github.com/samchon/ttsc/packages/ttsc/driver"

	"github.com/ts-refinement/ttsc-plugin/native/analysis"
	"github.com/ts-refinement/ttsc-plugin/native/entailment"
)

const runtimeModule = "@ts-refinement/runtime"

var refinementAssertionPattern = regexp.MustCompile(`\bas\s+|<\s*[A-Za-z_$][A-Za-z0-9_$]*`)

type protocolDiagnostic struct {
	File        *string `json:"file"`
	Category    string  `json:"category"`
	Code        any     `json:"code"`
	Start       *int    `json:"start,omitempty"`
	Length      *int    `json:"length,omitempty"`
	Line        *int    `json:"line,omitempty"`
	Character   *int    `json:"character,omitempty"`
	MessageText string  `json:"messageText"`
}

type transformOutput struct {
	Diagnostics []protocolDiagnostic   `json:"diagnostics,omitempty"`
	Graph       *driver.TransformGraph `json:"graph,omitempty"`
	TypeScript  map[string]string      `json:"typescript"`
}

type assertion struct {
	expression *shimast.Node
	node       *shimast.Node
	typeNode   *shimast.Node
	typePrefix bool
}

func RunTransform(args []string) int {
	options, err := parseOptions("transform", args)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	program, diagnostics, err := driver.LoadProgram(options.cwd, options.tsconfig, driver.LoadProgramOptions{
		ForceNoEmit: true,
		OutDir:      options.outDir,
	})
	if err != nil {
		return writeTransformOutput(transformOutput{
			Diagnostics: []protocolDiagnostic{globalDiagnostic("RF90400", err.Error())},
			TypeScript:  map[string]string{},
		}, 2)
	}
	if len(diagnostics) > 0 {
		return writeTransformOutput(transformOutput{
			Diagnostics: driverDiagnostics(diagnostics),
			TypeScript:  map[string]string{},
		}, 2)
	}
	defer program.Close()

	output := transformOutput{
		Graph:      driver.NewTransformGraph(program, options.cwd),
		TypeScript: map[string]string{},
	}
	printer := shimprinter.NewPrinter(shimprinter.PrinterOptions{}, shimprinter.PrintHandlers{}, nil)
	for _, file := range program.SourceFiles() {
		transformed, fileDiagnostics := transformFile(program.Checker, file)
		output.Diagnostics = append(output.Diagnostics, fileDiagnostics...)
		if transformed == "" {
			transformed = shimprinter.EmitSourceFile(printer, file)
		}
		output.TypeScript[driver.TransformOutputKey(options.cwd, file.FileName())] = transformed
	}
	status := 0
	if len(output.Diagnostics) > 0 {
		status = 2
	}
	return writeTransformOutput(output, status)
}

func RunBuild(args []string) int {
	options, err := parseOptions("build", args)
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
	typeScriptDiagnostics := filterEntailedRefinementDiagnostics(
		program.Checker,
		program.SourceFiles(),
		program.Diagnostics(),
	)
	if len(typeScriptDiagnostics) > 0 {
		driver.WritePrettyDiagnostics(os.Stderr, typeScriptDiagnostics, options.cwd)
		_ = program.Close()
		return 2
	}
	tracker, err := newNativeBuildTracker(options.cwd, options.tsconfig)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		_ = program.Close()
		return 3
	}

	overlay := driver.NewOverlayFS(driver.DefaultFS())
	refinementDiagnostics := []protocolDiagnostic{}
	for _, file := range program.SourceFiles() {
		transformed, fileDiagnostics := transformFileWithTracker(program.Checker, file, tracker)
		refinementDiagnostics = append(refinementDiagnostics, fileDiagnostics...)
		if transformed != "" {
			overlay.Set(file.FileName(), transformed)
		}
	}
	_ = program.Close()
	if len(refinementDiagnostics) > 0 {
		writeProtocolDiagnostics(os.Stderr, refinementDiagnostics)
		return 2
	}

	emitProgram, diagnostics, err := driver.LoadProgram(options.cwd, options.tsconfig, driver.LoadProgramOptions{
		FS:          overlay,
		ForceEmit:   options.emit,
		ForceNoEmit: options.noEmit,
		OutDir:      options.outDir,
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	if len(diagnostics) > 0 {
		driver.WritePrettyDiagnostics(os.Stderr, diagnostics, options.cwd)
		return 2
	}
	if options.emit && emitProgram.ParsedConfig != nil && emitProgram.ParsedConfig.ParsedConfig != nil {
		compilerOptions := emitProgram.ParsedConfig.ParsedConfig.CompilerOptions
		if compilerOptions != nil && compilerOptions.AllowImportingTsExtensions == shimcore.TSTrue {
			compilerOptions.RewriteRelativeImportExtensions = shimcore.TSTrue
		}
	}
	defer emitProgram.Close()
	manifestDirectory := options.cwd
	if emitProgram.ParsedConfig != nil && emitProgram.ParsedConfig.ParsedConfig != nil {
		if outDir := emitProgram.ParsedConfig.ParsedConfig.CompilerOptions.OutDir; outDir != "" {
			manifestDirectory = outDir
		}
	}
	assets := []nativeManifestAsset{}
	_, emitDiagnostics, err := emitProgram.EmitAllRaw(
		func(fileName, text string, _ *shimcompiler.WriteFileData) error {
			if err := driver.DefaultWriteFile(fileName, text); err != nil {
				return err
			}
			if asset, ok := nativeManifestAssetFor(manifestDirectory, fileName, text); ok {
				assets = append(assets, asset)
			}
			return nil
		},
	)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 3
	}
	if len(emitDiagnostics) > 0 {
		driver.WritePrettyDiagnostics(os.Stderr, emitDiagnostics, options.cwd)
		if driver.CountErrors(emitDiagnostics) > 0 {
			return 2
		}
	}
	if len(assets) > 0 {
		if err := tracker.write(manifestDirectory, assets); err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 3
		}
	}
	return 0
}

func transformFile(checker *shimchecker.Checker, file *shimast.SourceFile) (string, []protocolDiagnostic) {
	return transformFileWithTracker(checker, file, nil)
}

func transformFileWithTracker(
	checker *shimchecker.Checker,
	file *shimast.SourceFile,
	tracker *nativeBuildTracker,
) (string, []protocolDiagnostic) {
	if checker == nil || file == nil {
		return "", nil
	}
	source := file.Text()
	if !refinementAssertionPattern.MatchString(source) {
		return "", nil
	}
	plan := newEditPlan()
	diagnostics := []protocolDiagnostic{}
	runtimeAlias := uniqueName(source, "__ts_refinement_error")
	hasRuntimeCheck := false

	var visit func(*shimast.Node)
	visit = func(node *shimast.Node) {
		if node == nil {
			return
		}
		if site, ok := assertionAt(node); ok {
			targetType := checker.GetTypeAtLocation(site.typeNode)
			resolution := analysis.Resolve(checker, targetType, site.typeNode)
			checks := analysis.ResolveChecks(checker, targetType, site.typeNode)
			if !resolution.Refinement && len(checks.Checks) == 0 && len(checks.Issues) == 0 {
				goto children
			}
			issues := append([]analysis.Issue(nil), checks.Issues...)
			if resolution.Refinement {
				issues = append(issues, resolution.Issues...)
			}
			seenIssues := map[string]struct{}{}
			for _, issue := range issues {
				key := fmt.Sprintf("%d:%s", issue.Code, issue.Message)
				if _, exists := seenIssues[key]; exists {
					continue
				}
				seenIssues[key] = struct{}{}
				diagnostics = append(diagnostics, nodeDiagnostic(file, site.typeNode, issue.Code, issue.Message))
			}
			if len(seenIssues) == 0 && len(checks.Checks) > 0 {
				proven := false
				sourceType := checker.GetTypeAtLocation(site.expression)
				if resolution.Definition == nil && sourceType != nil &&
					sourceType.Flags()&(shimchecker.TypeFlagsAny|shimchecker.TypeFlagsUnknown) != 0 {
					diagnostics = append(diagnostics, nodeDiagnostic(
						file,
						site.node,
						analysis.DiagnosticSourceNotAssignable,
						fmt.Sprintf("Source type '%s' is not assignable to a nested refinement target.", checker.TypeToString(sourceType)),
					))
					goto children
				}
				sourceHasRefinement, sourceValid := containsRefinement(checker, sourceType)
				targetHasRefinement, targetValid := containsRefinement(checker, targetType)
				if sourceValid && targetValid && sourceHasRefinement && targetHasRefinement {
					proven = refinementStructureIsEntailed(checker, sourceType, targetType)
				}
				if !proven {
					directProof := true
					var directIssue *protocolDiagnostic
					if resolution.Definition != nil {
						directProof, directIssue = proveAssertion(checker, file, site, resolution.Definition)
					}
					nestedProof, nestedIssue := proveNestedChecks(file, site, checks.Checks)
					if directIssue != nil {
						diagnostics = append(diagnostics, *directIssue)
					} else if nestedIssue != nil {
						diagnostics = append(diagnostics, *nestedIssue)
					} else {
						proven = directProof && nestedProof
					}
				}
				if len(diagnostics) == 0 {
					addAssertionRemoval(plan, file, site)
					if !proven {
						hasRuntimeCheck = true
						marker := ""
						if tracker != nil {
							marker = tracker.register(file, site, checks.Checks, checks.Recursions)
						}
						addRuntimeWrapper(plan, file, site, checks.Checks, checks.Recursions, runtimeAlias, marker)
					}
				}
			}
		}
	children:
		node.ForEachChild(func(child *shimast.Node) bool {
			visit(child)
			return false
		})
	}
	visit(file.AsNode())
	if len(diagnostics) > 0 || len(plan.removals) == 0 {
		return "", diagnostics
	}
	if hasRuntimeCheck {
		position := importInsertionPoint(file, source)
		plan.insert(position, insertion{
			kind: insertionImport,
			text: fmt.Sprintf("import { RefinementError as %s } from %s;\n", runtimeAlias, quoted(runtimeModule)),
		})
	}
	transformed, err := plan.apply(source)
	if err != nil {
		return "", []protocolDiagnostic{globalDiagnostic("RF90400", err.Error())}
	}
	parsed := shimparser.ParseSourceFile(
		shimast.SourceFileParseOptions{FileName: file.FileName()},
		transformed,
		scriptKind(file.FileName()),
	)
	if parsed == nil {
		return "", []protocolDiagnostic{globalDiagnostic("RF90400", "TypeScript-Go could not parse transformed source.")}
	}
	printer := shimprinter.NewPrinter(shimprinter.PrinterOptions{}, shimprinter.PrintHandlers{}, nil)
	return shimprinter.EmitSourceFile(printer, parsed), nil
}

func assertionAt(node *shimast.Node) (assertion, bool) {
	switch node.Kind {
	case shimast.KindAsExpression:
		value := node.AsAsExpression()
		if value != nil && value.Expression != nil && value.Type != nil {
			return assertion{expression: value.Expression, node: node, typeNode: value.Type}, true
		}
	case shimast.KindTypeAssertionExpression:
		value := node.AsTypeAssertion()
		if value != nil && value.Expression != nil && value.Type != nil {
			return assertion{expression: value.Expression, node: node, typeNode: value.Type, typePrefix: true}, true
		}
	}
	return assertion{}, false
}

func proveAssertion(
	checker *shimchecker.Checker,
	file *shimast.SourceFile,
	site assertion,
	target *analysis.Definition,
) (bool, *protocolDiagnostic) {
	sourceType := checker.GetTypeAtLocation(site.expression)
	if sourceType == nil {
		diagnostic := nodeDiagnostic(file, site.expression, analysis.DiagnosticUnableResolveMetadata, "Unable to resolve assertion source type.")
		return false, &diagnostic
	}
	sourceResolution := analysis.Resolve(checker, sourceType, site.expression)
	if sourceResolution.Definition != nil && analysis.DefinitionEntails(checker, sourceResolution.Definition, target) {
		return true, nil
	}
	if sourceType.Flags()&(shimchecker.TypeFlagsAny|shimchecker.TypeFlagsUnknown) != 0 || !sourceAssignableToDefinition(checker, sourceType, target) {
		message := fmt.Sprintf(
			"Source type '%s' is not assignable to refinement base type '%s'.",
			checker.TypeToString(sourceType),
			definitionBaseDisplay(checker, target),
		)
		diagnostic := nodeDiagnostic(file, site.expression, analysis.DiagnosticSourceNotAssignable, message)
		return false, &diagnostic
	}
	guards := collectGuardPredicates(checker, file, site)
	if len(guards) > 0 {
		facts := entailment.Facts{}
		for _, base := range target.BaseTypes {
			if base.Flags()&shimchecker.TypeFlagsStringLike != 0 || shimchecker.Checker_isArrayType(checker, base) {
				facts.SubjectLength = true
			}
		}
		if entailment.Entails(guards, target.Predicates, facts) {
			return true, nil
		}
	}

	expressionSource := nodeText(file, site.expression)
	allKnown := true
	for _, predicate := range target.Predicates {
		result, known := entailment.Evaluate(predicate, expressionSource)
		if known && !result {
			message := fmt.Sprintf(
				"Value '%s' does not satisfy refinement '%s'. Predicate: %s.",
				expressionSource,
				target.Display,
				predicate.Source,
			)
			diagnostic := nodeDiagnostic(file, site.node, analysis.DiagnosticStaticallyDisproven, message)
			return false, &diagnostic
		}
		allKnown = allKnown && known
	}
	return allKnown, nil
}

func sourceAssignableToDefinition(checker *shimchecker.Checker, source *shimchecker.Type, target *analysis.Definition) bool {
	for _, base := range target.BaseTypes {
		if !checker.IsTypeAssignableTo(source, base) {
			return false
		}
	}
	return true
}

func definitionBaseDisplay(checker *shimchecker.Checker, definition *analysis.Definition) string {
	values := make([]string, len(definition.BaseTypes))
	for index, base := range definition.BaseTypes {
		values[index] = checker.TypeToString(base)
	}
	return strings.Join(values, " & ")
}

func addAssertionRemoval(plan *editPlan, file *shimast.SourceFile, site assertion) {
	if site.typePrefix {
		plan.remove(tokenStart(file, site.node), tokenStart(file, site.expression))
		return
	}
	plan.remove(site.expression.End(), site.node.End())
}

func addRuntimeWrapper(
	plan *editPlan,
	file *shimast.SourceFile,
	site assertion,
	checks []analysis.Check,
	recursions []analysis.Recursion,
	errorAlias string,
	marker string,
) {
	validation := emitValidator(checks, recursions, errorAlias, marker)
	prefix := fmt.Sprintf(
		"((__ts_refinement_value: any) => {\n%s\n    return __ts_refinement_value;\n  })(",
		validation,
	)
	start := tokenStart(file, site.expression)
	if site.typePrefix {
		start = tokenStart(file, site.node)
	}
	plan.insert(start, insertion{
		kind:      insertionPrefix,
		nodeStart: tokenStart(file, site.node),
		nodeEnd:   site.node.End(),
		text:      prefix,
	})
	plan.insert(site.expression.End(), insertion{
		kind:      insertionSuffix,
		nodeStart: tokenStart(file, site.node),
		nodeEnd:   site.node.End(),
		text:      ")",
	})
}

func nodeText(file *shimast.SourceFile, node *shimast.Node) string {
	if file == nil || node == nil {
		return ""
	}
	source := file.Text()
	start := tokenStart(file, node)
	end := node.End()
	if start < 0 || end > len(source) || start >= end {
		return ""
	}
	return strings.TrimRight(source[start:end], " \t\r\n")
}

func tokenStart(file *shimast.SourceFile, node *shimast.Node) int {
	return shimscanner.SkipTrivia(file.Text(), node.Pos())
}

func importInsertionPoint(file *shimast.SourceFile, source string) int {
	position := 0
	if strings.HasPrefix(source, "#!") {
		if end := strings.IndexByte(source, '\n'); end >= 0 {
			position = end + 1
		} else {
			return len(source)
		}
	}
	if file.Statements == nil {
		return position
	}
	for _, statement := range file.Statements.Nodes {
		if statement == nil || statement.Kind != shimast.KindExpressionStatement {
			break
		}
		expressionStatement := statement.AsExpressionStatement()
		if expressionStatement == nil || expressionStatement.Expression == nil || expressionStatement.Expression.Kind != shimast.KindStringLiteral {
			break
		}
		lineEnd := strings.IndexByte(source[statement.End():], '\n')
		if lineEnd < 0 {
			position = len(source)
		} else {
			position = statement.End() + lineEnd + 1
		}
	}
	return position
}

func uniqueName(source, base string) string {
	name := base
	for strings.Contains(source, name) {
		name += "_"
	}
	return name
}

func quoted(value string) string {
	encoded, _ := json.Marshal(value)
	return string(encoded)
}

func scriptKind(fileName string) shimcore.ScriptKind {
	switch strings.ToLower(filepath.Ext(fileName)) {
	case ".js", ".mjs", ".cjs":
		return shimcore.ScriptKindJS
	case ".jsx":
		return shimcore.ScriptKindJSX
	case ".tsx":
		return shimcore.ScriptKindTSX
	default:
		return shimcore.ScriptKindTS
	}
}

func nodeDiagnostic(file *shimast.SourceFile, node *shimast.Node, code int32, message string) protocolDiagnostic {
	start := tokenStart(file, node)
	length := node.End() - start
	line, character := shimscanner.GetECMALineAndByteOffsetOfPosition(file, start)
	line++
	character++
	fileName := file.FileName()
	return protocolDiagnostic{
		File:        &fileName,
		Category:    "error",
		Code:        fmt.Sprintf("RF%d", code),
		Start:       &start,
		Length:      &length,
		Line:        &line,
		Character:   &character,
		MessageText: message,
	}
}

func globalDiagnostic(code any, message string) protocolDiagnostic {
	return protocolDiagnostic{Category: "error", Code: code, MessageText: message}
}

func driverDiagnostics(diagnostics []driver.Diagnostic) []protocolDiagnostic {
	output := make([]protocolDiagnostic, 0, len(diagnostics))
	for _, diagnostic := range diagnostics {
		var file *string
		if diagnostic.File != "" {
			fileName := diagnostic.File
			file = &fileName
		}
		var line, character *int
		if diagnostic.Line > 0 {
			lineValue := diagnostic.Line
			characterValue := diagnostic.Column
			line = &lineValue
			character = &characterValue
		}
		output = append(output, protocolDiagnostic{
			File:        file,
			Category:    "error",
			Code:        diagnostic.Code,
			Start:       diagnostic.Start,
			Length:      diagnostic.Length,
			Line:        line,
			Character:   character,
			MessageText: diagnostic.Message,
		})
	}
	return output
}

func writeTransformOutput(output transformOutput, status int) int {
	encoded, err := json.Marshal(output)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	fmt.Fprintln(os.Stdout, string(encoded))
	return status
}

func writeProtocolDiagnostics(output *os.File, diagnostics []protocolDiagnostic) {
	for _, diagnostic := range diagnostics {
		if diagnostic.File != nil && diagnostic.Line != nil && diagnostic.Character != nil {
			fmt.Fprintf(
				output,
				"%s(%d,%d): error %v: %s\n",
				*diagnostic.File,
				*diagnostic.Line,
				*diagnostic.Character,
				diagnostic.Code,
				diagnostic.MessageText,
			)
			continue
		}
		fmt.Fprintf(output, "error %v: %s\n", diagnostic.Code, diagnostic.MessageText)
	}
}
