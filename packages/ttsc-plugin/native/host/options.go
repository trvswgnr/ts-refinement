package host

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type options struct {
	cwd      string
	tsconfig string
	outDir   string
	emit     bool
	noEmit   bool
}

func parseOptions(command string, args []string) (options, error) {
	filtered := make([]string, 0, len(args))
	for index := 0; index < len(args); index++ {
		argument := args[index]
		name := strings.TrimPrefix(strings.SplitN(argument, "=", 2)[0], "--")
		switch name {
		case "cwd", "tsconfig", "outDir", "emit", "noEmit":
			filtered = append(filtered, argument)
			if !strings.Contains(argument, "=") && name != "emit" && name != "noEmit" && index+1 < len(args) {
				index++
				filtered = append(filtered, args[index])
			}
		default:
			if strings.HasPrefix(argument, "--") && !strings.Contains(argument, "=") && index+1 < len(args) && !strings.HasPrefix(args[index+1], "-") {
				index++
			}
		}
	}
	set := flag.NewFlagSet(command, flag.ContinueOnError)
	set.SetOutput(os.Stderr)
	cwd := set.String("cwd", "", "project directory")
	tsconfig := set.String("tsconfig", "tsconfig.json", "TypeScript configuration")
	outDir := set.String("outDir", "", "output directory")
	emit := set.Bool("emit", false, "force emit")
	noEmit := set.Bool("noEmit", false, "disable emit")
	if err := set.Parse(filtered); err != nil {
		return options{}, err
	}
	if *emit && *noEmit {
		return options{}, fmt.Errorf("--emit and --noEmit are mutually exclusive")
	}
	if *cwd == "" {
		var err error
		*cwd, err = os.Getwd()
		if err != nil {
			return options{}, err
		}
	}
	absolute, err := filepath.Abs(*cwd)
	if err != nil {
		return options{}, err
	}
	return options{cwd: absolute, tsconfig: *tsconfig, outDir: *outDir, emit: *emit, noEmit: *noEmit}, nil
}
