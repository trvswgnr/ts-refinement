package host

import (
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf16"

	shimast "github.com/microsoft/typescript-go/shim/ast"
	"github.com/samchon/ttsc/packages/ttsc/driver"
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

func RunLSPCommandIDs([]string) int {
	return writeJSON([]string{})
}

func RunLSPCodeActionKinds([]string) int {
	return writeJSON([]string{})
}

func RunLSPCodeActions([]string) int {
	return writeJSON([]any{})
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
