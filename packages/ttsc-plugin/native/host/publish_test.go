package host

import "testing"

func TestDirectPublishVerificationCommand(t *testing.T) {
	packagePath := "/project/package.json"
	tests := []struct {
		name    string
		prepack string
		outDir  string
		want    bool
	}{
		{name: "direct", prepack: "ts-refinement verify dist", outDir: "dist", want: true},
		{name: "build first", prepack: "build && ts-refinement verify dist", outDir: "dist", want: true},
		{name: "quoted output", prepack: "ts-refinement verify 'dist files'", outDir: "dist files", want: true},
		{name: "successful exit", prepack: "exit && ts-refinement verify dist", outDir: "dist", want: true},
		{name: "unreachable", prepack: "false && ts-refinement verify dist", outDir: "dist", want: false},
		{name: "failure ignored", prepack: "ts-refinement verify dist || echo ignored", outDir: "dist", want: false},
		{name: "wrong output", prepack: "ts-refinement verify build", outDir: "dist", want: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := hasDirectVerifyCommand(packagePath, test.prepack, test.outDir); got != test.want {
				t.Fatalf("hasDirectVerifyCommand() = %v, want %v", got, test.want)
			}
		})
	}
}
