import { describe, expect, it } from "vitest";
import ts from "typescript";

import {
  emitPredicateWithSubject,
  normalizePredicate,
  parsePredicate,
  standardGlobals,
  type NormalizedExpression,
} from "@ts-refinement/analyzer";

const allowedGlobals = [
  "Array",
  "BigInt",
  "Boolean",
  "Date",
  "Infinity",
  "JSON",
  "Map",
  "Math",
  "NaN",
  "Number",
  "Object",
  "RegExp",
  "Set",
  "String",
  "Symbol",
  "WeakMap",
  "WeakSet",
  "isFinite",
  "isNaN",
  "parseFloat",
  "parseInt",
  "undefined",
] as const;

const removedGlobals = [
  "AggregateError",
  "ArrayBuffer",
  "Atomics",
  "BigInt64Array",
  "BigUint64Array",
  "DataView",
  "Error",
  "EvalError",
  "FinalizationRegistry",
  "Float32Array",
  "Float64Array",
  "Function",
  "Int8Array",
  "Int16Array",
  "Int32Array",
  "Intl",
  "Promise",
  "Proxy",
  "RangeError",
  "ReferenceError",
  "Reflect",
  "SharedArrayBuffer",
  "SyntaxError",
  "TypeError",
  "URIError",
  "Uint8Array",
  "Uint8ClampedArray",
  "Uint16Array",
  "Uint32Array",
  "WeakRef",
  "WebAssembly",
  "decodeURI",
  "decodeURIComponent",
  "encodeURI",
  "encodeURIComponent",
  "escape",
  "eval",
  "globalThis",
  "unescape",
] as const;

function normalized(source: string) {
  const parsed = parsePredicate(ts, source);
  if (!parsed.ok) throw new Error(parsed.diagnostics[0]?.message);
  return normalizePredicate(ts, parsed.predicate);
}

function callbackOf(expression: NormalizedExpression) {
  if (expression.kind !== "call") throw new Error("expected a normalized call");
  const callback = expression.arguments[0];
  if (callback?.kind !== "function") throw new Error("expected a normalized callback");
  return callback;
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

  it("normalizes callback bindings with lexical de Bruijn indices", () => {
    expect(normalized("xs.every(a => a > 0)").key).toBe(normalized("xs.every(b => b > 0)").key);
    const first = normalized("xs.every((value, index) => value > 0 || index === 0)");
    const renamed = normalized("items.every((item, position) => item > 0 || position === 0)");
    expect(first.key).toBe(renamed.key);
    expect(callbackOf(first.expression).body).toMatchObject({
      kind: "binary",
      left: { left: { index: 1, kind: "local" } },
      right: { left: { index: 0, kind: "local" } },
    });
  });

  it("preserves binding structure while normalizing destructured names", () => {
    expect(normalized("xs.every(({ value: a }, [b]) => a > b)").key).toBe(
      normalized("items.every(({ value: first }, [second]) => first > second)").key,
    );
    expect(normalized("xs.every(({ left: a }) => a > 0)").key).not.toBe(
      normalized("xs.every(({ right: a }) => a > 0)").key,
    );
  });

  it("resolves nested shadowing to the correct lexical binding", () => {
    const shadowed = normalized("xs.every(a => xs.some(a => a > 0))");
    const outerReference = normalized("xs.every(a => xs.some(b => a > 0))");
    const renamedOuterReference = normalized("items.every(x => items.some(y => x > 0))");

    expect(shadowed.key).not.toBe(outerReference.key);
    expect(outerReference.key).toBe(renamedOuterReference.key);
    const shadowedInner = callbackOf(callbackOf(shadowed.expression).body);
    const outerReferencingInner = callbackOf(callbackOf(outerReference.expression).body);
    expect(shadowedInner.body).toMatchObject({ left: { index: 0, kind: "local" } });
    expect(outerReferencingInner.body).toMatchObject({ left: { index: 1, kind: "local" } });
  });

  it("keeps free identifiers name-sensitive", () => {
    const number = normalized("Number(n) > 0");
    const string = normalized("String(n) > 0");
    expect(number.key).not.toBe(string.key);
    expect(number.expression).toMatchObject({
      left: { callee: { kind: "free", name: "Number" } },
    });
  });

  it("canonicalizes opaque syntax from each subtree only", () => {
    const opaqueSubtrees = normalized("/x/.test(n) && /y/.test(n)");
    expect(opaqueSubtrees.expression).toMatchObject({
      kind: "binary",
      left: { callee: { object: { kind: "opaque", text: "/x/" } } },
      right: { callee: { object: { kind: "opaque", text: "/y/" } } },
    });

    expect(normalized("xs.every(a => ({ value: a }).value > 0)").key).not.toBe(
      normalized("xs.every(b => ({ value: b }).value > 0)").key,
    );
  });

  it("distinguishes subject holes from identically spelled local names", () => {
    expect(normalized("xs.every(SUBJECT => ({ value: xs }).value > 0)").key).not.toBe(
      normalized("items.every(SUBJECT => ({ value: SUBJECT }).value > 0)").key,
    );
  });

  it("preserves function spelling when source text is observed", () => {
    expect(normalized('xs.every(a => (a => 1).toString().includes("a"))').key).not.toBe(
      normalized('xs.every(b => (b => 1).toString().includes("a"))').key,
    );
    expect(normalized('xs.every(a => String(a => 1).includes("a"))').key).not.toBe(
      normalized('xs.every(b => String(b => 1).includes("a"))').key,
    );
    expect(normalized('xs.every(a => String.call(null, a => 1).includes("a"))').key).not.toBe(
      normalized('xs.every(b => String.call(null, b => 1).includes("a"))').key,
    );
    expect(normalized('xs.every(a => ("" + (a => 1)).includes("a"))').key).not.toBe(
      normalized('xs.every(b => ("" + (b => 1)).includes("a"))').key,
    );
    expect(
      normalized(
        'xs.every(a => ({ map: callback => callback.toString() }).map(a => 1).includes("a"))',
      ).key,
    ).not.toBe(
      normalized(
        'xs.every(b => ({ map: callback => callback.toString() }).map(b => 1).includes("a"))',
      ).key,
    );
  });

  it("caches normalized predicates for editor latency", () => {
    expect(normalized("n >= 0")).toBe(normalized("n >= 0"));
  });

  it("distinguishes standard globals from the subject", () => {
    const parsed = parsePredicate(ts, "Number.isInteger(n) && n > 0");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.predicate.subject).toBe("n");
  });

  it("accepts exactly the approved predicate globals", () => {
    expect([...standardGlobals]).toEqual(allowedGlobals);

    for (const name of allowedGlobals) {
      const parsed = parsePredicate(ts, `${name} === ${name} || subject`);
      expect(parsed.ok, name).toBe(true);
      if (parsed.ok) expect(parsed.predicate.subject, name).toBe("subject");
    }
  });

  it("rejects every global removed from the prior allowlist", () => {
    for (const name of removedGlobals) {
      expect(parsePredicate(ts, name).diagnostics[0]?.code, name).toBe(1002);
    }
  });

  it.each([
    ["eval", "eval('globalThis.PWNED = 1')"],
    ["Function", "Function('return true')()"],
    ["globalThis", "globalThis.PWNED"],
    ["Reflect", "Reflect.get({}, 'value')"],
  ])("rejects the high-risk %s call form", (_name, source) => {
    expect(parsePredicate(ts, source).diagnostics[0]?.code).toBe(1002);
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
