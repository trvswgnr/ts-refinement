package entailment

import "testing"

func TestEvaluateKnownLiterals(t *testing.T) {
	positive, err := ParsePredicate("value > 0")
	if err != nil {
		t.Fatal(err)
	}
	if result, known := Evaluate(positive, "5"); !known || !result {
		t.Fatalf("Evaluate(5) = %v, %v", result, known)
	}
	if result, known := Evaluate(positive, "-1"); !known || result {
		t.Fatalf("Evaluate(-1) = %v, %v", result, known)
	}

	nonEmpty, err := ParsePredicate("value.length > 0")
	if err != nil {
		t.Fatal(err)
	}
	if result, known := Evaluate(nonEmpty, `""`); !known || result {
		t.Fatalf("Evaluate(empty) = %v, %v", result, known)
	}

	utf16Length, err := ParsePredicate("value.length === 2")
	if err != nil {
		t.Fatal(err)
	}
	if result, known := Evaluate(utf16Length, `"😀"`); !known || !result {
		t.Fatalf("Evaluate(UTF-16 length) = %v, %v", result, known)
	}
}

func TestParsesJavaScriptNumericLiterals(t *testing.T) {
	for _, source := range []string{
		"value < 1e3",
		"value < 0x400",
		"value < 0b100_0000_0000",
		"value < 0o2000",
	} {
		if _, err := ParsePredicate(source); err != nil {
			t.Errorf("ParsePredicate(%q): %v", source, err)
		}
	}
	for _, source := range []string{"value < 1_000n", "value < 0x400n"} {
		if _, err := ParsePredicate(source); err != nil {
			t.Errorf("ParsePredicate(%q): %v", source, err)
		}
	}
}

func TestAcceptsShimParsedPredicateSyntax(t *testing.T) {
	for _, source := range []string{
		`/^[a-z]+$/.test(value)`,
		`({ value }).value > 0`,
		"`prefix_${value}`.length > 0",
		`value?.trim().length > 0`,
		`(value & 1) === 0`,
		`values.every(({ score }) => score > 0)`,
	} {
		predicate, err := ParsePredicate(source)
		if err != nil {
			t.Errorf("ParsePredicate(%q): %v", source, err)
			continue
		}
		if compiled := Compile(predicate, "input"); compiled == source {
			t.Errorf("Compile(%q) did not replace its subject", source)
		}
	}
}

func TestRejectsShimParsedSideEffectsAndImpureAccess(t *testing.T) {
	for _, source := range []string{
		`value++ > 0`,
		`value += 1`,
		`delete value.item`,
		`Math["random"]() < 0.5`,
		"Math[`random`]() < 0.5",
		`Math["ra" + "ndom"]() < 0.5`,
	} {
		if _, err := ParsePredicate(source); err == nil {
			t.Errorf("ParsePredicate(%q) succeeded", source)
		}
	}
}

func TestEvaluateArrayCallbacksAndSupportedExpressions(t *testing.T) {
	allPositive, err := ParsePredicate("values.every((item, index) => item > 0 && index >= 0)")
	if err != nil {
		t.Fatal(err)
	}
	if result, known := Evaluate(allPositive, "[1, 2, 3]"); !known || !result {
		t.Fatalf("Evaluate(positive array) = %v, %v", result, known)
	}
	if result, known := Evaluate(allPositive, "[1, -2, 3]"); !known || result {
		t.Fatalf("Evaluate(invalid array) = %v, %v", result, known)
	}

	conditional, err := ParsePredicate("typeof value === \"number\" ? value > 0 : false")
	if err != nil {
		t.Fatal(err)
	}
	if result, known := Evaluate(conditional, "1"); !known || !result {
		t.Fatalf("Evaluate(conditional) = %v, %v", result, known)
	}
}

func TestNormalizesCallbackBindingsAndStandardGlobals(t *testing.T) {
	left, err := ParsePredicate("values.every(item => Boolean(item))")
	if err != nil {
		t.Fatal(err)
	}
	right, err := ParsePredicate("items.every(value => Boolean(value))")
	if err != nil {
		t.Fatal(err)
	}
	if left.Key() != right.Key() {
		t.Fatalf("callback keys differ: %q != %q", left.Key(), right.Key())
	}
	if compiled := Compile(left, "input"); compiled != "input.every(($local0) => Boolean($local0))" {
		t.Fatalf("unexpected callback output: %q", compiled)
	}
}

func TestFoldsLiteralCapturesBeforeSubjectInference(t *testing.T) {
	identifiers, err := FreeIdentifiers("value > LIMIT")
	if err != nil {
		t.Fatal(err)
	}
	if len(identifiers) != 2 || identifiers[0] != "LIMIT" || identifiers[1] != "value" {
		t.Fatalf("unexpected free identifiers: %#v", identifiers)
	}
	captured, err := ParsePredicateWithCaptures("value > LIMIT", map[string]string{"LIMIT": "5"})
	if err != nil {
		t.Fatal(err)
	}
	literal, err := ParsePredicate("value > 5")
	if err != nil {
		t.Fatal(err)
	}
	if captured.Key() != literal.Key() {
		t.Fatalf("captured key %q != literal key %q", captured.Key(), literal.Key())
	}
	if compiled := Compile(captured, "input"); compiled != "(input > 5)" {
		t.Fatalf("unexpected capture output: %q", compiled)
	}
}

func TestRespectsCallbackBindingsDuringNormalization(t *testing.T) {
	captured, err := ParsePredicateWithCaptures(
		"values.every((LIMIT) => LIMIT > 0) && LIMIT > 0",
		map[string]string{"LIMIT": "1"},
	)
	if err != nil {
		t.Fatal(err)
	}
	if compiled := Compile(captured, "input"); compiled != "(input.every(($local0) => ($local0 > 0)) && (1 > 0))" {
		t.Fatalf("unexpected shadowed capture output: %q", compiled)
	}

	shadowedSubject, err := ParsePredicate("value.every((value) => value > 0)")
	if err != nil {
		t.Fatal(err)
	}
	if compiled := Compile(shadowedSubject, "input"); compiled != "input.every(($local0) => ($local0 > 0))" {
		t.Fatalf("unexpected shadowed subject output: %q", compiled)
	}
}

func TestRejectsImpureAndAmbiguousPredicates(t *testing.T) {
	for _, source := range []string{"Math.random() < 0.5", "Date.now() > 0", "value > minimum"} {
		if _, err := ParsePredicate(source); err == nil {
			t.Fatalf("ParsePredicate(%q) succeeded", source)
		}
	}
}
