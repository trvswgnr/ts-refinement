package entailment

import "testing"

func parsePredicatesForTest(t *testing.T, sources ...string) []Predicate {
	t.Helper()
	predicates, err := ParsePredicates(sources)
	if err != nil {
		t.Fatal(err)
	}
	return predicates
}

func TestNegatedNumericBoundRequiresFiniteness(t *testing.T) {
	source := parsePredicatesForTest(t, "!(value > 0)")
	target := parsePredicatesForTest(t, "value <= 0")
	if Entails(source, target, Facts{}) {
		t.Fatal("negated bound incorrectly entails target for NaN")
	}

	finiteSource := parsePredicatesForTest(t, "Number.isFinite(value)", "!(value > 0)")
	if !Entails(finiteSource, target, Facts{}) {
		t.Fatal("finite negated bound did not entail target")
	}

	equalSource := parsePredicatesForTest(t, "!(value !== 5)")
	equalTarget := parsePredicatesForTest(t, "value === 5")
	if !Entails(equalSource, equalTarget, Facts{}) {
		t.Fatal("negated inequality did not entail strict equality")
	}
}

func TestCongruenceEntailmentPreservesRemainderSign(t *testing.T) {
	negative := parsePredicatesForTest(t, "Number.isInteger(value)", "value % 4 === -1")
	positiveTarget := parsePredicatesForTest(t, "value % 2 === 1")
	if Entails(negative, positiveTarget, Facts{}) {
		t.Fatal("negative JavaScript remainder incorrectly entails positive remainder")
	}

	positive := parsePredicatesForTest(t, "Number.isInteger(value)", "value % 4 === 3")
	if !Entails(positive, positiveTarget, Facts{}) {
		t.Fatal("positive congruence did not entail compatible positive remainder")
	}
}
