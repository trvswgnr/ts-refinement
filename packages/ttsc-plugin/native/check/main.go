package main

import (
	"fmt"
	"os"

	"github.com/ts-refinement/ttsc-plugin/native/host"
)

const version = "0.1.0"

func main() {
	os.Exit(run(os.Args[1:]))
}

func run(args []string) int {
	if len(args) == 0 {
		fmt.Fprintln(os.Stderr, "@ts-refinement/ttsc check: command required")
		return 2
	}
	switch args[0] {
	case "-v", "--version", "version":
		fmt.Fprintf(os.Stdout, "@ts-refinement/ttsc %s\n", version)
		return 0
	case "check":
		return host.RunCheck(args[1:])
	case "lsp-command-ids":
		return host.RunLSPCommandIDs(args[1:])
	case "lsp-code-action-kinds":
		return host.RunLSPCodeActionKinds(args[1:])
	case "lsp-diagnostics":
		return host.RunLSPDiagnostics(args[1:])
	case "lsp-code-actions":
		return host.RunLSPCodeActions(args[1:])
	default:
		fmt.Fprintf(os.Stderr, "@ts-refinement/ttsc check: unknown command %q\n", args[0])
		return 2
	}
}
