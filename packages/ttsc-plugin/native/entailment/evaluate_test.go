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

func TestRejectsImpureAndAmbiguousPredicates(t *testing.T) {
	for _, source := range []string{"Math.random() < 0.5", "Date.now() > 0", "value > minimum"} {
		if _, err := ParsePredicate(source); err == nil {
			t.Fatalf("ParsePredicate(%q) succeeded", source)
		}
	}
}
