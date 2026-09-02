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

func TestRejectsImpureAndAmbiguousPredicates(t *testing.T) {
	for _, source := range []string{"Math.random() < 0.5", "Date.now() > 0", "value > minimum"} {
		if _, err := ParsePredicate(source); err == nil {
			t.Fatalf("ParsePredicate(%q) succeeded", source)
		}
	}
}
