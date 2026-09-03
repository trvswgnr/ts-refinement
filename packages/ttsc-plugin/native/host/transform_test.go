package host

import "testing"

func TestRefinementAssertionPrefilter(t *testing.T) {
	for _, source := range []string{
		"const value = input as Positive",
		"const value = input\nas\nPositive",
		"const value = <Positive>input",
	} {
		if !refinementAssertionPattern.MatchString(source) {
			t.Errorf("expected assertion candidate in %q", source)
		}
	}

	for _, source := range []string{
		"export const value = 1",
		"export function identity(value: number): number { return value }",
		"interface Example { value: number }",
	} {
		if refinementAssertionPattern.MatchString(source) {
			t.Errorf("expected assertion-free source in %q", source)
		}
	}
}
