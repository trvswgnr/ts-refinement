package host

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf16"

	shimast "github.com/microsoft/typescript-go/shim/ast"
	shimchecker "github.com/microsoft/typescript-go/shim/checker"
	"github.com/samchon/ttsc/packages/ttsc/driver"

	"github.com/ts-refinement/ttsc-plugin/native/analysis"
)

const (
	lspQuickFixKind                  = "quickfix.ts-refinement"
	lspRemoveInvalidAssertionCommand = "ts-refinement.removeInvalidAssertion"
)

type lspPosition struct {
	Line      int `json:"line"`
	Character int `json:"character"`
}

type lspRange struct {
	Start lspPosition `json:"start"`
	End   lspPosition `json:"end"`
}

type lspDiagnostic struct {
	Range    lspRange `json:"range"`
	Severity int      `json:"severity,omitempty"`
	Code     string   `json:"code,omitempty"`
	Source   string   `json:"source,omitempty"`
	Message  string   `json:"message"`
}

type lspDiagnosticsResult struct {
	Document []lspDiagnostic `json:"document"`
}

type lspCodeActionContext struct {
	Only []string `json:"only,omitempty"`
}

type lspEditArgument struct {
	NewText    string   `json:"newText"`
	Range      lspRange `json:"range"`
	SourceHash string   `json:"sourceHash"`
	URI        string   `json:"uri"`
}

type lspCommand struct {
	Arguments []lspEditArgument `json:"arguments,omitempty"`
	Command   string            `json:"command"`
	Title     string            `json:"title"`
}

type lspCodeAction struct {
	Command     lspCommand `json:"command"`
	IsPreferred bool       `json:"isPreferred,omitempty"`
	Kind        string     `json:"kind,omitempty"`
	Title       string     `json:"title"`
}

type lspTextEdit struct {
	NewText string   `json:"newText"`
	Range   lspRange `json:"range"`
}

type lspWorkspaceEdit struct {
	Changes map[string][]lspTextEdit `json:"changes,omitempty"`
}

func RunLSPCommandIDs([]string) int {
	return writeJSON([]string{lspRemoveInvalidAssertionCommand})
}

func RunLSPCodeActionKinds([]string) int {
	return writeJSON([]string{lspQuickFixKind})
}

func RunLSPCodeActions(args []string) int {
	actions, err := computeLSPCodeActions(args)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	return writeJSON(actions)
}

func RunLSPExecuteCommand(args []string) int {
	edit, err := computeLSPExecuteCommand(args)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	return writeJSON(edit)
}

func RunLSPDiagnostics(args []string) int {
	result, err := computeLSPDiagnostics(args)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	return writeJSON(result)
}

func computeLSPDiagnostics(args []string) (lspDiagnosticsResult, error) {
	result := lspDiagnosticsResult{Document: []lspDiagnostic{}}
	uri := optionValue(args, "uri")
	if uri == "" {
		return result, fmt.Errorf("@ts-refinement/ttsc lsp-diagnostics: --uri is required")
	}
	fileName, err := fileNameFromURI(uri)
	if err != nil {
		return result, err
	}
	options, err := parseOptions("lsp-diagnostics", args)
	if err != nil {
		return result, err
	}
	program, parseDiagnostics, err := driver.LoadProgram(options.cwd, options.tsconfig, driver.LoadProgramOptions{ForceNoEmit: true})
	if err != nil {
		return result, err
	}
	if len(parseDiagnostics) > 0 {
		return result, fmt.Errorf("TypeScript project contains %d configuration diagnostic(s)", len(parseDiagnostics))
	}
	defer program.Close()

	file := sourceFileByName(program.SourceFiles(), fileName)
	if file == nil {
		return result, nil
	}
	diagnostics := refinementDefinitionDiagnostics(program.Checker, file)
	_, assertionDiagnostics := transformFile(program.Checker, file)
	diagnostics = append(diagnostics, assertionDiagnostics...)
	seen := map[string]struct{}{}
	for _, diagnostic := range diagnostics {
		if diagnostic.Start == nil || diagnostic.Length == nil {
			continue
		}
		key := fmt.Sprintf("%v:%d:%d:%s", diagnostic.Code, *diagnostic.Start, *diagnostic.Length, diagnostic.MessageText)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		result.Document = append(result.Document, lspDiagnostic{
			Range:    lspRangeForSpan(file.Text(), *diagnostic.Start, *diagnostic.Length),
			Severity: 1,
			Code:     fmt.Sprint(diagnostic.Code),
			Source:   "ts-refinement",
			Message:  diagnostic.MessageText,
		})
	}
	return result, nil
}

func computeLSPCodeActions(args []string) ([]lspCodeAction, error) {
	result := []lspCodeAction{}
	uri := optionValue(args, "uri")
	if uri == "" {
		return result, fmt.Errorf("@ts-refinement/ttsc lsp-code-actions: --uri is required")
	}
	fileName, err := fileNameFromURI(uri)
	if err != nil {
		return result, err
	}
	var requestedRange lspRange
	if err := parseJSONOption(args, "range-json", &requestedRange); err != nil {
		return result, err
	}
	if !validLSPRange(requestedRange) {
		return result, fmt.Errorf("@ts-refinement/ttsc lsp-code-actions: invalid range")
	}
	context := lspCodeActionContext{}
	if raw := optionValue(args, "context-json"); raw != "" {
		if err := json.Unmarshal([]byte(raw), &context); err != nil {
			return result, fmt.Errorf("@ts-refinement/ttsc lsp-code-actions: invalid --context-json: %w", err)
		}
	}
	if !actionKindRequested(context.Only, lspQuickFixKind) {
		return result, nil
	}

	options, err := parseOptions("lsp-code-actions", args)
	if err != nil {
		return result, err
	}
	program, parseDiagnostics, err := driver.LoadProgram(options.cwd, options.tsconfig, driver.LoadProgramOptions{ForceNoEmit: true})
	if err != nil {
		return result, err
	}
	if len(parseDiagnostics) > 0 {
		return result, fmt.Errorf("TypeScript project contains %d configuration diagnostic(s)", len(parseDiagnostics))
	}
	defer program.Close()
	file := sourceFileByName(program.SourceFiles(), fileName)
	if file == nil {
		return result, nil
	}
	for _, argument := range disprovenAssertionEdits(program.Checker, file, uri) {
		if !lspRangesIntersect(argument.Range, requestedRange) {
			continue
		}
		const title = "Remove invalid refinement assertion"
		result = append(result, lspCodeAction{
			Command: lspCommand{
				Arguments: []lspEditArgument{argument},
				Command:   lspRemoveInvalidAssertionCommand,
				Title:     title,
			},
			IsPreferred: true,
			Kind:        lspQuickFixKind,
			Title:       title,
		})
	}
	return result, nil
}

func computeLSPExecuteCommand(args []string) (*lspWorkspaceEdit, error) {
	command := optionValue(args, "command")
	if command != lspRemoveInvalidAssertionCommand {
		return nil, fmt.Errorf("@ts-refinement/ttsc lsp-execute-command: unsupported command %q", command)
	}
	var arguments []lspEditArgument
	if err := parseJSONOption(args, "arguments-json", &arguments); err != nil {
		return nil, err
	}
	if len(arguments) != 1 || !validLSPRange(arguments[0].Range) {
		return nil, fmt.Errorf("@ts-refinement/ttsc lsp-execute-command: expected one valid edit argument")
	}
	argument := arguments[0]
	fileName, err := fileNameFromURI(argument.URI)
	if err != nil {
		return nil, err
	}
	source, err := os.ReadFile(fileName)
	if err != nil {
		return nil, fmt.Errorf("@ts-refinement/ttsc lsp-execute-command: %w", err)
	}
	if fmt.Sprintf("%x", sha256.Sum256(source)) != argument.SourceHash {
		return nil, nil
	}
	return &lspWorkspaceEdit{Changes: map[string][]lspTextEdit{
		argument.URI: {{NewText: argument.NewText, Range: argument.Range}},
	}}, nil
}

func disprovenAssertionEdits(
	checker *shimchecker.Checker,
	file *shimast.SourceFile,
	uri string,
) []lspEditArgument {
	_, diagnostics := transformFile(checker, file)
	spans := map[string]struct{}{}
	for _, diagnostic := range diagnostics {
		if fmt.Sprint(diagnostic.Code) != fmt.Sprintf("RF%d", analysis.DiagnosticStaticallyDisproven) ||
			diagnostic.Start == nil || diagnostic.Length == nil {
			continue
		}
		spans[fmt.Sprintf("%d:%d", *diagnostic.Start, *diagnostic.Length)] = struct{}{}
	}
	if len(spans) == 0 {
		return nil
	}
	source := file.Text()
	sourceHash := fmt.Sprintf("%x", sha256.Sum256([]byte(source)))
	edits := []lspEditArgument{}
	var visit func(*shimast.Node)
	visit = func(node *shimast.Node) {
		if node == nil {
			return
		}
		if site, ok := assertionAt(node); ok {
			start := tokenStart(file, site.node)
			length := site.node.End() - start
			if _, exists := spans[fmt.Sprintf("%d:%d", start, length)]; exists {
				edits = append(edits, lspEditArgument{
					NewText:    nodeText(file, site.expression),
					Range:      lspRangeForSpan(source, start, length),
					SourceHash: sourceHash,
					URI:        uri,
				})
			}
		}
		node.ForEachChild(func(child *shimast.Node) bool {
			visit(child)
			return false
		})
	}
	visit(file.AsNode())
	return edits
}

func parseJSONOption(args []string, name string, target any) error {
	raw := optionValue(args, name)
	if raw == "" {
		return fmt.Errorf("@ts-refinement/ttsc: --%s is required", name)
	}
	if err := json.Unmarshal([]byte(raw), target); err != nil {
		return fmt.Errorf("@ts-refinement/ttsc: invalid --%s: %w", name, err)
	}
	return nil
}

func actionKindRequested(only []string, kind string) bool {
	if len(only) == 0 {
		return true
	}
	for _, requested := range only {
		if kind == requested || strings.HasPrefix(kind, requested+".") {
			return true
		}
	}
	return false
}

func validLSPRange(value lspRange) bool {
	return value.Start.Line >= 0 && value.Start.Character >= 0 &&
		value.End.Line >= 0 && value.End.Character >= 0 &&
		compareLSPPositions(value.Start, value.End) <= 0
}

func lspRangesIntersect(left, right lspRange) bool {
	if compareLSPPositions(right.Start, right.End) == 0 {
		return compareLSPPositions(left.Start, right.Start) <= 0 &&
			compareLSPPositions(right.Start, left.End) <= 0
	}
	return compareLSPPositions(left.Start, right.End) < 0 &&
		compareLSPPositions(right.Start, left.End) < 0
}

func compareLSPPositions(left, right lspPosition) int {
	if left.Line != right.Line {
		return left.Line - right.Line
	}
	return left.Character - right.Character
}

func sourceFileByName(files []*shimast.SourceFile, fileName string) *shimast.SourceFile {
	target := filepath.Clean(fileName)
	for _, file := range files {
		if filepath.Clean(file.FileName()) == target {
			return file
		}
	}
	return nil
}

func lspRangeForSpan(source string, start, length int) lspRange {
	if start < 0 {
		start = 0
	}
	if start > len(source) {
		start = len(source)
	}
	end := start + length
	if end > len(source) {
		end = len(source)
	}
	return lspRange{
		Start: lspPositionAt(source, start),
		End:   lspPositionAt(source, end),
	}
}

func lspPositionAt(source string, offset int) lspPosition {
	prefix := source[:offset]
	line := strings.Count(prefix, "\n")
	lineStart := strings.LastIndexByte(prefix, '\n') + 1
	character := len(utf16.Encode([]rune(source[lineStart:offset])))
	return lspPosition{Line: line, Character: character}
}

func optionValue(args []string, name string) string {
	prefix := "--" + name + "="
	for index, argument := range args {
		if strings.HasPrefix(argument, prefix) {
			return strings.TrimPrefix(argument, prefix)
		}
		if argument == "--"+name && index+1 < len(args) {
			return args[index+1]
		}
	}
	return ""
}

func fileNameFromURI(value string) (string, error) {
	parsed, err := url.Parse(value)
	if err != nil {
		return "", fmt.Errorf("invalid document URI: %w", err)
	}
	if parsed.Scheme != "file" {
		return "", fmt.Errorf("unsupported document URI scheme %q", parsed.Scheme)
	}
	return filepath.FromSlash(parsed.Path), nil
}

func writeJSON(value any) int {
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	return 0
}
