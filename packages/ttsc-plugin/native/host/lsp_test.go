package host

import (
	"encoding/json"
	"net/url"
	"path/filepath"
	"testing"
)

func TestLSPRemovesStaticallyDisprovenAssertion(t *testing.T) {
	repositoryRoot, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	fileName := filepath.Join(repositoryRoot, "fixtures/ttsc/invalid/index.ts")
	uri := (&url.URL{Scheme: "file", Path: filepath.ToSlash(fileName)}).String()
	requestedRange := lspRange{
		Start: lspPosition{Line: 8, Character: 0},
		End:   lspPosition{Line: 8, Character: 200},
	}
	rangeJSON, _ := json.Marshal(requestedRange)
	contextJSON, _ := json.Marshal(lspCodeActionContext{Only: []string{"quickfix"}})
	actions, err := computeLSPCodeActions([]string{
		"--cwd=" + repositoryRoot,
		"--tsconfig=fixtures/ttsc/invalid/tsconfig.json",
		"--uri=" + uri,
		"--range-json=" + string(rangeJSON),
		"--context-json=" + string(contextJSON),
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(actions) != 1 {
		t.Fatalf("got %d actions, want 1", len(actions))
	}
	action := actions[0]
	if action.Kind != lspQuickFixKind || action.Command.Command != lspRemoveInvalidAssertionCommand {
		t.Fatalf("unexpected action: %#v", action)
	}
	if len(action.Command.Arguments) != 1 || action.Command.Arguments[0].NewText != "-1" {
		t.Fatalf("unexpected action arguments: %#v", action.Command.Arguments)
	}

	argumentsJSON, _ := json.Marshal(action.Command.Arguments)
	edit, err := computeLSPExecuteCommand([]string{
		"--command=" + lspRemoveInvalidAssertionCommand,
		"--arguments-json=" + string(argumentsJSON),
	})
	if err != nil {
		t.Fatal(err)
	}
	if edit == nil || len(edit.Changes[uri]) != 1 {
		t.Fatalf("unexpected workspace edit: %#v", edit)
	}
	textEdit := edit.Changes[uri][0]
	if textEdit.NewText != "-1" || textEdit.Range != action.Command.Arguments[0].Range {
		t.Fatalf("unexpected text edit: %#v", textEdit)
	}
}

func TestLSPCodeActionsHonorOnlyAndRejectStaleEdits(t *testing.T) {
	repositoryRoot, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	fileName := filepath.Join(repositoryRoot, "fixtures/ttsc/invalid/index.ts")
	uri := (&url.URL{Scheme: "file", Path: filepath.ToSlash(fileName)}).String()
	rangeJSON, _ := json.Marshal(lspRange{
		Start: lspPosition{Line: 0, Character: 0},
		End:   lspPosition{Line: 100, Character: 0},
	})
	contextJSON, _ := json.Marshal(lspCodeActionContext{Only: []string{"refactor"}})
	actions, err := computeLSPCodeActions([]string{
		"--uri=" + uri,
		"--range-json=" + string(rangeJSON),
		"--context-json=" + string(contextJSON),
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(actions) != 0 {
		t.Fatalf("got %d actions for refactor-only request", len(actions))
	}

	stale := lspEditArgument{
		NewText:    "-1",
		Range:      lspRange{Start: lspPosition{}, End: lspPosition{Character: 1}},
		SourceHash: "stale",
		URI:        uri,
	}
	argumentsJSON, _ := json.Marshal([]lspEditArgument{stale})
	edit, err := computeLSPExecuteCommand([]string{
		"--command=" + lspRemoveInvalidAssertionCommand,
		"--arguments-json=" + string(argumentsJSON),
	})
	if err != nil {
		t.Fatal(err)
	}
	if edit != nil {
		t.Fatalf("stale action returned edit: %#v", edit)
	}
}

func TestLSPPositionsUseUTF16AndFileURIsDecode(t *testing.T) {
	source := "😀x\nvalue"
	range_ := lspRangeForSpan(source, len("😀"), 1)
	if range_.Start != (lspPosition{Line: 0, Character: 2}) {
		t.Fatalf("UTF-16 start = %#v", range_.Start)
	}

	want := filepath.FromSlash("/tmp/refinement path/value#test.ts")
	uri := (&url.URL{Scheme: "file", Path: filepath.ToSlash(want)}).String()
	got, err := fileNameFromURI(uri)
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("fileNameFromURI() = %q, want %q", got, want)
	}
}
