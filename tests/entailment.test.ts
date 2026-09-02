import { describe, expect, it } from "vitest";
import {
  array,
  assert,
  bigInt,
  constantFrom,
  double,
  integer,
  oneof,
  property,
  string,
  tuple,
} from "fast-check";
import ts from "typescript";

import {
  entails,
  evaluateExpression,
  normalizePredicate,
  parsePredicate,
  type NormalizedPredicate,
  type StaticRuntimeValue,
} from "@ts-refinement/analyzer";

function predicate(source: string): NormalizedPredicate {
  const parsed = parsePredicate(ts, source);
  if (!parsed.ok) throw new Error(parsed.diagnostics[0]?.message);
  return normalizePredicate(ts, parsed.predicate);
}

function predicates(sources: readonly string[]): readonly NormalizedPredicate[] {
  return sources.map(predicate);
}

function holds(all: readonly NormalizedPredicate[], value: StaticRuntimeValue): boolean {
  return all.every((item) => {
    const result = evaluateExpression(item.expression, { known: true, value });
    return result.known && Boolean(result.value);
  });
}

describe("normalized predicate entailment", () => {
  it("uses exact normalized keys for unsupported atoms", () => {
    const opaque = predicate("Math.abs(n) > 0");
    expect(entails([opaque], [opaque])).toBe(true);
    expect(entails([opaque], [predicate("Math.abs(n) > 1")])).toBe(false);
    expect(entails([predicate("n > 0 && Math.abs(n) > 1")], [opaque])).toBe(false);
    expect(
      entails([predicate("n > 0 && Math.abs(n) > 1")], [predicate("Math.abs(value) > 1")]),
    ).toBe(true);
  });

  it("proves interval implication and normalizes comparison direction", () => {
    expect(entails([predicate("n > 5")], [predicate("n > 0")])).toBe(true);
    expect(entails([predicate("n >= 1")], [predicate("n > -1")])).toBe(true);
    expect(entails([predicate("n > 0")], [predicate("value > 0")])).toBe(true);
    expect(entails([predicate("5 < n")], [predicate("n >= 5")])).toBe(true);
    expect(entails([predicate("n > 0")], [predicate("n > 5")])).toBe(false);
  });

  it("distinguishes open and closed interval boundaries", () => {
    expect(entails([predicate("n > 5")], [predicate("n >= 5")])).toBe(true);
    expect(entails([predicate("n >= 5")], [predicate("n > 5")])).toBe(false);
    expect(entails([predicate("n < 5")], [predicate("n <= 5")])).toBe(true);
    expect(entails([predicate("n <= 5")], [predicate("n < 5")])).toBe(false);
    expect(entails([predicate("n === 5")], [predicate("n >= 5"), predicate("n <= 5")])).toBe(true);
    expect(entails([predicate("n >= 5"), predicate("n <= 5")], [predicate("n === 5")])).toBe(false);
  });

  it("meets facts across predicate arrays and expression conjunctions", () => {
    expect(
      entails([predicate("n > 0"), predicate("n < 10")], [predicate("n >= 0 && n <= 10")]),
    ).toBe(true);
    expect(entails([predicate("n > 0 && n < 10")], [predicate("n < 20")])).toBe(true);
    expect(entails([predicate("n > 0")], [predicate("n > -1"), predicate("n < 20")])).toBe(false);
  });

  it("keeps number and bigint domains independent", () => {
    expect(entails([predicate("n > 5n")], [predicate("n > 0n")])).toBe(true);
    expect(entails([predicate("n > 5n")], [predicate("n >= 6n")])).toBe(false);
    expect(entails([predicate("n < 5n")], [predicate("n <= 4n")])).toBe(false);
    expect(entails([predicate("!(n <= 5n)")], [predicate("n > 5n")])).toBe(false);
    expect(entails([predicate("n >= 5n")], [predicate("n + 1n >= 6n")])).toBe(false);
    expect(entails([predicate("n + 0n >= 5n")], [predicate("n + 1n >= 6n")])).toBe(true);
    expect(entails([predicate("-n < -10n")], [predicate("n + 0n > 10n")])).toBe(false);
    expect(entails([predicate("-n > -10n")], [predicate("n + 0n < 10n")])).toBe(false);
    expect(entails([predicate("n > 5")], [predicate("n > 0n")])).toBe(false);
    expect(entails([predicate("n > 5n")], [predicate("n > 0")])).toBe(false);
  });

  it("solves exact bigint linear shifts and scales", () => {
    expect(entails([predicate("2n * n + 1n >= 11n")], [predicate("n >= 5n")])).toBe(true);
    expect(entails([predicate("-2n * n < -10n")], [predicate("n > 5n")])).toBe(true);
    expect(entails([predicate("3n * n === 12n")], [predicate("n === 4n")])).toBe(false);
    expect(entails([predicate("3n * n === 11n")], [predicate("n === 3n")])).toBe(false);
    expect(entails([predicate("n + 1 > 5")], [predicate("n > 4")])).toBe(false);
    expect(entails([predicate("n > 0")], [predicate("n - n + n > 0")])).toBe(false);
    expect(
      entails(
        [predicate("Number.isInteger(n)"), predicate("2 * n + 1 >= 11")],
        [predicate("n >= 5")],
      ),
    ).toBe(true);
    expect(
      entails(
        [predicate("Number.isInteger(n)"), predicate("n >= 5")],
        [predicate("2 * n + 1 >= 11")],
      ),
    ).toBe(true);
  });

  it("uses equivalent negated comparisons only with safe numeric facts", () => {
    expect(
      entails([predicate("Number.isInteger(n)"), predicate("!(n <= 5)")], [predicate("n > 5")]),
    ).toBe(true);
    expect(entails([predicate("!(n <= 5)")], [predicate("n > 5")])).toBe(false);
    expect(entails([predicate("!(n + 0n <= 5n)")], [predicate("n > 5n")])).toBe(true);
    expect(entails([predicate("n > 5")], [predicate("!(n <= 5)")])).toBe(true);
  });

  it("tracks integrality and congruence classes conservatively", () => {
    expect(
      entails(
        [predicate("Number.isInteger(n)"), predicate("n % 4 === 0")],
        [predicate("n % 2 === 0")],
      ),
    ).toBe(true);
    expect(entails([predicate("n % 4 === 0")], [predicate("n % 2 === 0")])).toBe(false);
    expect(entails([predicate("n % 2n === 0n")], [predicate("n % 4n === 0n")])).toBe(false);
    expect(entails([predicate("n % 4n === 0n")], [predicate("n % 2n === 0n")])).toBe(true);
    expect(
      entails(
        [predicate("Number.isInteger(n)"), predicate("n % 6 === 4")],
        [predicate("n % 2 === 0")],
      ),
    ).toBe(true);
    expect(entails([predicate("n % 6n === 1n")], [predicate("n % 2n === 1n")])).toBe(true);
    expect(entails([predicate("n % 6n === -1n")], [predicate("n % 2n === -1n")])).toBe(true);
  });

  it("models length as a finite nonnegative integer term", () => {
    expect(entails([predicate("s.length > 5")], [predicate("s.length > 0")])).toBe(true);
    expect(entails([], [predicate("s.length >= 0")])).toBe(false);
    expect(entails([], [predicate("Number.isInteger(s.length)")])).toBe(false);
    expect(
      entails([predicate("Array.isArray(s)")], [predicate("Number.isInteger(s.length)")]),
    ).toBe(true);
    expect(entails([predicate('typeof s === "string"')], [predicate("s.length >= 0")])).toBe(true);
    expect(
      entails(
        [predicate("Array.isArray(s)"), predicate("s.length % 4 === 0")],
        [predicate("s.length % 2 === 0")],
      ),
    ).toBe(true);
    expect(entails([predicate("s.length % 4 === 0")], [predicate("s.length % 2 === 0")])).toBe(
      false,
    );
    expect(
      entails([predicate("s.length > 0")], [predicate("s.length >= 1")], {
        subjectLength: true,
      }),
    ).toBe(true);
  });

  it("derives finiteness from two-sided numeric bounds", () => {
    expect(entails([predicate("n > 0 && n < 10")], [predicate("Number.isFinite(n)")])).toBe(true);
    expect(entails([predicate("n > 0")], [predicate("Number.isFinite(n)")])).toBe(false);
  });

  it("is reflexive for generated normalized predicates", () => {
    const source = tuple(
      constantFrom("n", "value", "subject"),
      constantFrom(">", ">=", "<", "<=", "===", "%"),
      integer({ min: -20, max: 20 }),
    ).map(([name, operator, bound]) =>
      operator === "%" ? `${name} % 4 === ${bound % 4}` : `${name} ${operator} ${bound}`,
    );

    assert(
      property(source, (text) => {
        const item = predicate(text);
        expect(entails([item], [item])).toBe(true);
      }),
    );
  });

  it("never proves an invalid supported number implication over generated samples", () => {
    const atom = oneof(
      tuple(constantFrom(">", ">=", "<", "<=", "==="), integer({ min: -20, max: 20 })).map(
        ([operator, bound]) => `n ${operator} ${bound}`,
      ),
      tuple(constantFrom(">", ">=", "<", "<="), integer({ min: -20, max: 20 })).map(
        ([operator, bound]) => `-n ${operator} ${bound}`,
      ),
      tuple(constantFrom(">", ">=", "<", "<="), integer({ min: -20, max: 20 })).map(
        ([operator, bound]) => `2 * n + 1 ${operator} ${bound}`,
      ),
      constantFrom(
        "Number.isFinite(n)",
        "Number.isInteger(n)",
        "!(n <= 0)",
        "n % 2 === 0",
        "n % 3 === 1",
      ),
    );
    const conjunction = array(atom, { maxLength: 3 }).map(predicates);
    const value = oneof(
      constantFrom(NaN, Infinity, -Infinity, -0, 0, 0.5, -0.5),
      double({ noDefaultInfinity: true, noNaN: true }),
    );

    assert(
      property(conjunction, conjunction, value, (source, target, sample) => {
        if (entails(source, target) && holds(source, sample)) {
          expect(holds(target, sample)).toBe(true);
        }
      }),
      { numRuns: 1_000 },
    );
  });

  it("never proves an invalid supported bigint implication over generated samples", () => {
    const literal = integer({ min: -20, max: 20 });
    const atom = oneof(
      tuple(constantFrom(">", ">=", "<", "<=", "==="), literal).map(
        ([operator, bound]) => `n ${operator} ${bound}n`,
      ),
      tuple(constantFrom(">", ">=", "<", "<="), literal).map(
        ([operator, bound]) => `2n * n + 1n ${operator} ${bound}n`,
      ),
      literal.map((bound) => `!(n <= ${bound}n)`),
      tuple(constantFrom(2, 3, 4, 6), literal).map(
        ([modulus, remainder]) => `n % ${modulus}n === ${remainder % modulus}n`,
      ),
    );
    const conjunction = array(atom, { maxLength: 3 }).map(predicates);

    assert(
      property(
        conjunction,
        conjunction,
        bigInt({ min: -100n, max: 100n }),
        (source, target, sample) => {
          if (entails(source, target) && holds(source, sample)) {
            expect(holds(target, sample)).toBe(true);
          }
        },
      ),
      { numRuns: 1_000 },
    );
  });

  it("never proves an invalid length implication for string or array samples", () => {
    const atom = tuple(
      constantFrom(">", ">=", "<", "<=", "==="),
      integer({ min: -5, max: 20 }),
    ).map(([operator, bound]) => `s.length ${operator} ${bound}`);
    const conjunction = array(atom, { maxLength: 3 }).map(predicates);
    const value = oneof(string({ maxLength: 30 }), array(integer(), { maxLength: 30 }));

    assert(
      property(conjunction, conjunction, value, (source, target, sample) => {
        if (entails(source, target) && holds(source, sample)) {
          expect(holds(target, sample)).toBe(true);
        }
      }),
      { numRuns: 500 },
    );
  });

  it("does not generalize generated unsupported forms", () => {
    assert(
      property(
        tuple(integer({ min: -20, max: 20 }), integer({ min: -20, max: 20 })).filter(
          ([left, right]) => left !== right,
        ),
        ([left, right]) => {
          const source = predicate(`Math.abs(n) > ${left}`);
          const target = predicate(`Math.abs(n) > ${right}`);
          expect(entails([source], [source])).toBe(true);
          expect(entails([source], [target])).toBe(false);
        },
      ),
    );
  });
});
