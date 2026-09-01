import { describe, expect, it } from "vitest";
import { assert, double, property } from "fast-check";
import ts from "typescript";

import {
  evaluateExpression,
  normalizePredicate,
  parsePredicate,
  provePredicates,
  type StaticRuntimeValue,
} from "ts-refinement-types/analyzer";

function predicate(source: string) {
  const parsed = parsePredicate(ts, source);
  if (!parsed.ok) throw new Error(parsed.diagnostics[0]?.message);
  return normalizePredicate(ts, parsed.predicate);
}

function evaluate(source: string, subject: StaticRuntimeValue) {
  return evaluateExpression(predicate(source).expression, { known: true, value: subject });
}

describe("static proof", () => {
  it("proves basic arithmetic and comparisons", () => {
    expect(provePredicates([predicate("n > 0")], { known: true, value: 5 }).kind).toBe("true");
    expect(provePredicates([predicate("n > 0")], { known: true, value: -5 }).kind).toBe("false");
  });

  it("models Number.isInteger and Number.isFinite as ordinary JavaScript", () => {
    const predicates = [predicate("Number.isInteger(n)"), predicate("n % 2 === 0")];
    expect(provePredicates(predicates, { known: true, value: 4 }).kind).toBe("true");
    expect(provePredicates(predicates, { known: true, value: 5 }).kind).toBe("false");
    expect(
      provePredicates([predicate("Number.isFinite(n)")], { known: true, value: Infinity }).kind,
    ).toBe("false");
  });

  it("degrades unsupported operations to unknown", () => {
    expect(
      provePredicates([predicate("s.normalize() === s")], { known: true, value: "text" }).kind,
    ).toBe("unknown");
    expect(provePredicates([predicate("n > 0")], { known: false }).kind).toBe("unknown");
  });

  it("proves subjectless predicates without knowing the source value", () => {
    expect(provePredicates([predicate("true")], { known: false }).kind).toBe("true");
    expect(provePredicates([predicate("false")], { known: false }).kind).toBe("false");
  });

  it("proves primitive property access", () => {
    const nonEmpty = predicate("s.length > 0");
    expect(provePredicates([nonEmpty], { known: true, value: "x" }).kind).toBe("true");
    expect(provePredicates([nonEmpty], { known: true, value: "" }).kind).toBe("false");
  });

  it("models supported JavaScript operators conservatively", () => {
    expect(evaluate("n + 2", 5)).toEqual({ known: true, value: 7 });
    expect(evaluate("n - 2", 5)).toEqual({ known: true, value: 3 });
    expect(evaluate("n * 2", 5)).toEqual({ known: true, value: 10 });
    expect(evaluate("n / 2", 5)).toEqual({ known: true, value: 2.5 });
    expect(evaluate("n % 2", 5)).toEqual({ known: true, value: 1 });
    expect(evaluate("n ** 2", 5)).toEqual({ known: true, value: 25 });
    expect(evaluate('s + "!"', "hello")).toEqual({ known: true, value: "hello!" });
    expect(evaluate("n < 6", 5)).toEqual({ known: true, value: true });
    expect(evaluate("n <= 5", 5)).toEqual({ known: true, value: true });
    expect(evaluate("n >= 6", 5)).toEqual({ known: true, value: false });
    expect(evaluate("n !== 6", 5)).toEqual({ known: true, value: true });
    expect(evaluate("!n", 0)).toEqual({ known: true, value: true });
    expect(evaluate("+n", "5")).toEqual({ known: true, value: 5 });
    expect(evaluate("-n", "5")).toEqual({ known: true, value: -5 });
  });

  it("preserves short-circuit and conditional values", () => {
    expect(evaluate("n && 7", 0)).toEqual({ known: true, value: 0 });
    expect(evaluate("n && 7", 1)).toEqual({ known: true, value: 7 });
    expect(evaluate("n || 7", 0)).toEqual({ known: true, value: 7 });
    expect(evaluate("n || 7", 1)).toEqual({ known: true, value: 1 });
    expect(evaluate("n ?? 7", null)).toEqual({ known: true, value: 7 });
    expect(evaluate("n ?? 7", 0)).toEqual({ known: true, value: 0 });
    expect(evaluate('n ? "yes" : "no"', true)).toEqual({ known: true, value: "yes" });
    expect(evaluate('n ? "yes" : "no"', false)).toEqual({ known: true, value: "no" });
  });

  it("supports bigint operations without interpreting runtime failures", () => {
    expect(evaluate("n + 2n", 5n)).toEqual({ known: true, value: 7n });
    expect(evaluate("n - 2n", 5n)).toEqual({ known: true, value: 3n });
    expect(evaluate("n * 2n", 5n)).toEqual({ known: true, value: 10n });
    expect(evaluate("n / 2n", 5n)).toEqual({ known: true, value: 2n });
    expect(evaluate("n % 2n", 5n)).toEqual({ known: true, value: 1n });
    expect(evaluate("n ** 2n", 5n)).toEqual({ known: true, value: 25n });
    expect(evaluate("n / 0n", 5n)).toEqual({ known: false });
    expect(evaluate("n ** -1n", 5n)).toEqual({ known: false });
  });

  it("returns unknown rather than guessing unsupported semantics", () => {
    expect(evaluate("n == 5", 5)).toEqual({ known: false });
    expect(evaluate('n < "6"', 5)).toEqual({ known: false });
    expect(evaluate("n[0]", [1])).toEqual({ known: false });
    expect(evaluate("Number.parseInt(n)", "5")).toEqual({ known: false });
    expect(evaluate("n === n", [1])).toEqual({ known: false });
  });

  it("matches JavaScript arithmetic for finite numeric inputs", () => {
    const addition = predicate("n + 3").expression;
    const multiplication = predicate("n * 2").expression;

    assert(
      property(double({ noDefaultInfinity: true, noNaN: true }), (value) => {
        expect(evaluateExpression(addition, { known: true, value })).toEqual({
          known: true,
          value: value + 3,
        });
        expect(evaluateExpression(multiplication, { known: true, value })).toEqual({
          known: true,
          value: value * 2,
        });
      }),
    );
  });
});
