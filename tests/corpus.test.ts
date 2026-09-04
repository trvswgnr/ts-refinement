import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import ts from "typescript";
import * as v from "valibot";

import {
  entails,
  evaluateExpression,
  normalizePredicate,
  parsePredicate,
  type NormalizedPredicate,
} from "@ts-refinement/analyzer";

const primitiveValueSchema = v.union([v.boolean(), v.null(), v.number(), v.string()]);
const encodedValueSchema = v.pipe(
  v.variant("kind", [
    v.strictObject({ kind: v.literal("bigint"), value: v.string() }),
    v.strictObject({
      kind: v.literal("number"),
      value: v.picklist(["-Infinity", "Infinity", "NaN"]),
    }),
  ]),
  v.transform((value) => {
    if (value.kind === "bigint") return BigInt(value.value);
    if (value.value === "Infinity") return Infinity;
    if (value.value === "-Infinity") return -Infinity;
    return NaN;
  }),
);
const corpusValueSchema = v.union([
  primitiveValueSchema,
  v.array(primitiveValueSchema),
  encodedValueSchema,
]);
const corpusSchema = v.strictObject({
  cases: v.array(
    v.strictObject({
      expected: v.boolean(),
      facts: v.optional(v.strictObject({ subjectLength: v.optional(v.boolean()) })),
      name: v.string(),
      samples: v.array(corpusValueSchema),
      source: v.array(v.string()),
      target: v.array(v.string()),
    }),
  ),
  schemaVersion: v.literal(1),
});

function predicate(source: string): NormalizedPredicate {
  const parsed = parsePredicate(ts, source);
  if (!parsed.ok) throw new Error(parsed.diagnostics[0]?.message);
  return normalizePredicate(ts, parsed.predicate);
}

const corpus = v.parse(
  corpusSchema,
  JSON.parse(readFileSync(resolve(import.meta.dirname, "../spec/entailment-corpus.json"), "utf8")),
);

describe("shared entailment corpus", () => {
  it("matches every language-neutral case and positive sample", () => {
    expect(corpus.schemaVersion).toBe(1);
    for (const entry of corpus.cases) {
      const source = entry.source.map(predicate);
      const target = entry.target.map(predicate);
      expect(entails(source, target, entry.facts), entry.name).toBe(entry.expected);
      let sawCounterexample = false;
      for (const sample of entry.samples) {
        const sourceResults = source.map((item) =>
          evaluateExpression(item.expression, { known: true, value: sample }),
        );
        const targetResults = target.map((item) =>
          evaluateExpression(item.expression, { known: true, value: sample }),
        );
        if ([...sourceResults, ...targetResults].some((result) => !result.known)) continue;
        const sourceHolds = sourceResults.every((result) => result.known && Boolean(result.value));
        const targetHolds = targetResults.every((result) => result.known && Boolean(result.value));
        if (entry.expected) {
          expect(sourceHolds && targetHolds, `${entry.name}: ${String(sample)}`).toBe(true);
        } else if (sourceHolds && !targetHolds) {
          sawCounterexample = true;
        }
      }
      if (!entry.expected && entry.name.startsWith("generated number implication ")) {
        expect(sawCounterexample, entry.name).toBe(true);
      }
    }
  });
});
