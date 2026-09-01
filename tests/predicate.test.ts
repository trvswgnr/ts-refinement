import { describe, expect, it } from "vitest";
import ts from "typescript";

import {
  emitPredicateWithSubject,
  normalizePredicate,
  parsePredicate,
} from "ts-refinement-types/analyzer";

function normalized(source: string) {
  const parsed = parsePredicate(ts, source);
  if (!parsed.ok) throw new Error(parsed.diagnostics[0]?.message);
  return normalizePredicate(ts, parsed.predicate);
}

describe("predicate parsing and subject inference", () => {
  it("normalizes different subject names to the same identity", () => {
    expect(normalized("n > 0").key).toBe(normalized("value > 0").key);
    expect(normalized("/x/.test(s)").key).toBe(normalized(" /x/ . test( value ) ").key);
    expect(normalized("n ? 1 : 0").key).toBe(normalized("value ? 1 : 0").key);
    expect(normalized("[n, 1].length").key).toBe(normalized("[value, 1].length").key);
    expect(normalized("n[0]").key).toBe(normalized("value[0]").key);
    expect(normalized("!n").key).toBe(normalized("!value").key);
  });

  it("caches normalized predicates for editor latency", () => {
    expect(normalized("n >= 0")).toBe(normalized("n >= 0"));
  });

  it("distinguishes standard globals from the subject", () => {
    const parsed = parsePredicate(ts, "Number.isInteger(n) && n > 0");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.predicate.subject).toBe("n");
  });

  it("tracks arrow parameters as local bindings", () => {
    const parsed = parsePredicate(ts, "xs.every((x, i) => i === 0 || xs[i - 1] <= x)");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.predicate.subject).toBe("xs");

    const destructured = parsePredicate(
      ts,
      "xs.every(({ value }, index = 0) => value > index && xs.length > 0)",
    );
    expect(destructured.ok).toBe(true);
    if (destructured.ok) expect(destructured.predicate.subject).toBe("xs");
  });

  it("supports subjectless predicates", () => {
    const parsed = parsePredicate(ts, "true");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.predicate.subject).toBeNull();
  });

  it("rejects ambiguity, malformed syntax, and mutation", () => {
    expect(parsePredicate(ts, "n > min").diagnostics[0]?.code).toBe(1002);
    expect(parsePredicate(ts, "n >").diagnostics[0]?.code).toBe(1000);
    expect(parsePredicate(ts, "n += 1").diagnostics[0]?.code).toBe(1000);
    expect(parsePredicate(ts, "n++").diagnostics[0]?.code).toBe(1000);
    expect(parsePredicate(ts, "import('x')").diagnostics[0]?.code).toBe(1000);
    expect(parsePredicate(ts, "import.meta.url").diagnostics[0]?.code).toBe(1000);
    expect(parsePredicate(ts, "this.value").diagnostics[0]?.code).toBe(1000);
    expect(parsePredicate(ts, "delete n.value").diagnostics[0]?.code).toBe(1000);
    expect(parsePredicate(ts, "if (n) true").diagnostics[0]?.code).toBe(1000);
    expect(parsePredicate(ts, "(() => { return true; })()").diagnostics[0]?.code).toBe(1000);
  });

  it("does not treat host-environment identifiers as standard globals", () => {
    expect(parsePredicate(ts, "Buffer.isBuffer(n)").diagnostics[0]?.code).toBe(1002);
    const parsed = parsePredicate(ts, "Math.abs(n) < 10");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.predicate.subject).toBe("n");
  });

  it("substitutes only free subject references", () => {
    const parsed = parsePredicate(ts, "xs.every((x) => x > 0) && xs.length > 0");
    if (!parsed.ok) throw new Error(parsed.diagnostics[0]?.message);
    expect(emitPredicateWithSubject(ts, parsed.predicate, "value")).toBe(
      "value.every((x) => x > 0) && value.length > 0",
    );

    const shorthand = parsePredicate(ts, "({ n }).n > 0");
    if (!shorthand.ok) throw new Error(shorthand.diagnostics[0]?.message);
    expect(emitPredicateWithSubject(ts, shorthand.predicate, "value")).toBe("({ n: value }).n > 0");
  });
});
