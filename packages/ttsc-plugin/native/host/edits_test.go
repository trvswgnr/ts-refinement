package host

import "testing"

func TestEditPlanComposesChainedAssertions(t *testing.T) {
	source := "value as Positive as NonNegative"
	plan := newEditPlan()
	plan.remove(5, 17)
	plan.remove(17, len(source))
	plan.insert(0, insertion{kind: insertionPrefix, nodeStart: 0, nodeEnd: len(source), text: "outer("})
	plan.insert(0, insertion{kind: insertionPrefix, nodeStart: 0, nodeEnd: 17, text: "inner("})
	plan.insert(5, insertion{kind: insertionSuffix, nodeStart: 0, nodeEnd: 17, text: ")"})
	plan.insert(17, insertion{kind: insertionSuffix, nodeStart: 0, nodeEnd: len(source), text: ")"})

	output, err := plan.apply(source)
	if err != nil {
		t.Fatal(err)
	}
	if output != "outer(inner(value))" {
		t.Fatalf("unexpected chained assertion output: %q", output)
	}
}

func TestEditPlanClosesNestedPrefixAssertionsInsideOut(t *testing.T) {
	source := "<Outer><Inner>value"
	plan := newEditPlan()
	plan.remove(0, 7)
	plan.remove(7, 14)
	plan.insert(0, insertion{kind: insertionPrefix, nodeStart: 0, nodeEnd: len(source), text: "outer("})
	plan.insert(7, insertion{kind: insertionPrefix, nodeStart: 7, nodeEnd: len(source), text: "inner("})
	plan.insert(len(source), insertion{kind: insertionSuffix, nodeStart: 0, nodeEnd: len(source), text: ")"})
	plan.insert(len(source), insertion{kind: insertionSuffix, nodeStart: 7, nodeEnd: len(source), text: ")"})

	output, err := plan.apply(source)
	if err != nil {
		t.Fatal(err)
	}
	if output != "outer(inner(value))" {
		t.Fatalf("unexpected nested assertion output: %q", output)
	}
}

func TestEditPlanKeepsImportsBeforeWrappersAtSharedPosition(t *testing.T) {
	plan := newEditPlan()
	plan.insert(0, insertion{kind: insertionPrefix, text: "check("})
	plan.insert(0, insertion{kind: insertionImport, text: "import { check } from \"runtime\";\n"})
	plan.insert(5, insertion{kind: insertionSuffix, text: ")"})

	output, err := plan.apply("value")
	if err != nil {
		t.Fatal(err)
	}
	if output != "import { check } from \"runtime\";\ncheck(value)" {
		t.Fatalf("unexpected import ordering: %q", output)
	}
}
