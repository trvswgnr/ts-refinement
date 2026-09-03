package host

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	shimast "github.com/microsoft/typescript-go/shim/ast"
	shimchecker "github.com/microsoft/typescript-go/shim/checker"

	"github.com/ts-refinement/ttsc-plugin/native/analysis"
)

type packageVerification struct {
	configured bool
	name       string
	path       string
	private    bool
}

type packageMetadata struct {
	Name         string            `json:"name"`
	Private      bool              `json:"private"`
	Scripts      map[string]string `json:"scripts"`
	TSRefinement struct {
		Verify struct {
			OutDir string `json:"outDir"`
		} `json:"verify"`
	} `json:"ts-refinement"`
}

type shellCommand struct {
	preceding string
	words     []string
}

func shellCommands(source string) []shellCommand {
	commands := []shellCommand{}
	words := []string{}
	preceding := ""
	quote := rune(0)
	token := strings.Builder{}
	escaped := false
	flushToken := func() {
		if token.Len() == 0 {
			return
		}
		words = append(words, token.String())
		token.Reset()
	}
	flushCommand := func(operator string) {
		flushToken()
		if len(words) > 0 {
			commands = append(commands, shellCommand{preceding: preceding, words: words})
			words = []string{}
		}
		preceding = operator
	}
	runes := []rune(source)
	for index := 0; index < len(runes); index++ {
		character := runes[index]
		if escaped {
			token.WriteRune(character)
			escaped = false
			continue
		}
		if quote != 0 {
			if character == quote {
				quote = 0
			} else if quote == '"' && character == '\\' {
				escaped = true
			} else {
				token.WriteRune(character)
			}
			continue
		}
		switch character {
		case '\'', '"':
			quote = character
		case '\\':
			escaped = true
		case ' ', '\t', '\n', '\r':
			flushToken()
		case ';', '&', '|':
			operator := string(character)
			if index+1 < len(runes) && runes[index+1] == character {
				operator += string(character)
				index++
			}
			flushCommand(operator)
		default:
			token.WriteRune(character)
		}
	}
	flushCommand("")
	return commands
}

func commandAlwaysFails(command shellCommand) bool {
	if len(command.words) == 0 {
		return false
	}
	if command.words[0] == "false" {
		return true
	}
	if command.words[0] != "exit" {
		return false
	}
	code := 0
	if len(command.words) > 1 {
		parsed, err := strconv.Atoi(command.words[1])
		if err != nil {
			return false
		}
		code = parsed
	}
	return code != 0
}

func commandIsReachable(commands []shellCommand, index int) bool {
	for position := index; position > 0; position-- {
		preceding := commands[position].preceding
		if preceding == ";" || preceding == "" {
			return true
		}
		if preceding != "&&" || commandAlwaysFails(commands[position-1]) {
			return false
		}
	}
	return true
}

func hasDirectVerifyCommand(packagePath, prepack, outDir string) bool {
	packageDirectory := filepath.Dir(packagePath)
	configuredDirectory := filepath.Clean(filepath.Join(packageDirectory, outDir))
	commands := shellCommands(prepack)
	for index, command := range commands {
		if len(command.words) < 3 || filepath.Base(command.words[0]) != "ts-refinement" ||
			command.words[1] != "verify" ||
			filepath.Clean(filepath.Join(packageDirectory, command.words[2])) != configuredDirectory ||
			!commandIsReachable(commands, index) {
			continue
		}
		validTail := true
		for _, following := range commands[index+1:] {
			if following.preceding != "&&" {
				validTail = false
				break
			}
		}
		if validTail {
			return true
		}
	}
	return false
}

func readPackageVerification(packagePath string) *packageVerification {
	data, err := os.ReadFile(packagePath)
	if err != nil {
		return nil
	}
	metadata := packageMetadata{}
	if json.Unmarshal(data, &metadata) != nil {
		return nil
	}
	outDir := metadata.TSRefinement.Verify.OutDir
	prepack := metadata.Scripts["prepack"]
	return &packageVerification{
		configured: outDir != "" && prepack != "" && hasDirectVerifyCommand(packagePath, prepack, outDir),
		name:       metadata.Name,
		path:       packagePath,
		private:    metadata.Private,
	}
}

func nearestPackage(fileName string) *packageVerification {
	directory, err := filepath.Abs(filepath.Dir(fileName))
	if err != nil {
		return nil
	}
	for {
		packagePath := filepath.Join(directory, "package.json")
		if verification := readPackageVerification(packagePath); verification != nil {
			return verification
		}
		parent := filepath.Dir(directory)
		if parent == directory {
			return nil
		}
		directory = parent
	}
}

func symbolTarget(checker *shimchecker.Checker, symbol *shimast.Symbol) *shimast.Symbol {
	if symbol != nil && symbol.Flags&shimast.SymbolFlagsAlias != 0 {
		return shimchecker.Checker_getAliasedSymbol(checker, symbol)
	}
	return symbol
}

func exportDeclaration(checker *shimchecker.Checker, symbol *shimast.Symbol, file *shimast.SourceFile) *shimast.Node {
	for _, declaration := range symbol.Declarations {
		if shimast.GetSourceFileOfNode(declaration) == file {
			return declaration
		}
	}
	target := symbolTarget(checker, symbol)
	for _, statement := range file.Statements.Nodes {
		if statement.Kind != shimast.KindExportDeclaration {
			continue
		}
		export := statement.AsExportDeclaration()
		if export.ExportClause != nil || export.ModuleSpecifier == nil {
			continue
		}
		moduleSymbol := checker.GetSymbolAtLocation(export.ModuleSpecifier)
		for _, candidate := range shimchecker.Checker_getExportsOfModule(checker, moduleSymbol) {
			if symbolTarget(checker, candidate) == target {
				return statement
			}
		}
	}
	return nil
}

func exportType(checker *shimchecker.Checker, symbol *shimast.Symbol, declaration *shimast.Node) *shimchecker.Type {
	target := symbol
	if target.Flags&shimast.SymbolFlagsAlias != 0 {
		target = symbolTarget(checker, target)
	}
	if target == nil {
		return nil
	}
	if target.Flags&shimast.SymbolFlagsType != 0 {
		return shimchecker.Checker_getDeclaredTypeOfSymbol(checker, target)
	}
	return shimchecker.Checker_getTypeOfSymbolAtLocation(checker, target, declaration)
}

func publishVerificationDiagnostics(checker *shimchecker.Checker, file *shimast.SourceFile) []protocolDiagnostic {
	if checker == nil || file == nil || strings.Contains(filepath.ToSlash(file.FileName()), "/node_modules/") {
		return nil
	}
	verification := nearestPackage(file.FileName())
	if verification == nil || verification.private || verification.configured {
		return nil
	}
	moduleSymbol := checker.GetSymbolAtLocation(file.AsNode())
	if moduleSymbol == nil {
		return nil
	}
	diagnostics := []protocolDiagnostic{}
	seen := map[int]struct{}{}
	for _, symbol := range shimchecker.Checker_getExportsOfModule(checker, moduleSymbol) {
		declaration := exportDeclaration(checker, symbol, file)
		if declaration == nil {
			continue
		}
		location := declaration.Name()
		if location == nil {
			location = declaration
		}
		if _, exists := seen[location.Pos()]; exists {
			continue
		}
		hasRefinement, valid := containsRefinement(checker, exportType(checker, symbol, declaration))
		if !valid || !hasRefinement {
			continue
		}
		seen[location.Pos()] = struct{}{}
		message := fmt.Sprintf(
			"Exported declaration '%s' exposes refinement types without configured publish verification in '%s'.",
			symbol.Name,
			verification.path,
		)
		diagnostic := nodeDiagnostic(file, location, analysis.DiagnosticPublishVerification, message)
		diagnostic.Category = "warning"
		diagnostics = append(diagnostics, diagnostic)
	}
	return diagnostics
}
