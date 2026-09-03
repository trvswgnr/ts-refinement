import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { sample } from "fast-check";
import ts from "typescript";
import * as v from "valibot";

import {
  evaluateExpression,
  normalizePredicate,
  parsePredicate,
  type NormalizedPredicate,
  type StaticRuntimeValue,
} from "@ts-refinement/analyzer";
import { generatedEntailmentInputs } from "../spec/entailment-generators.ts";

const corpusCaseSchema = v.strictObject({
  expected: v.boolean(),
  facts: v.optional(v.strictObject({ subjectLength: v.optional(v.boolean()) })),
  name: v.string(),
  samples: v.array(v.unknown()),
  source: v.array(v.string()),
  target: v.array(v.string()),
});
const corpusSchema = v.strictObject({
  cases: v.array(corpusCaseSchema),
  schemaVersion: v.literal(1),
});

type CorpusCase = v.InferOutput<typeof corpusCaseSchema>;
type Corpus = v.InferOutput<typeof corpusSchema>;

const generatedPrefix = "generated number implication ";
const repositoryRoot = resolve(import.meta.dirname, "..");
const corpusPath = resolve(import.meta.dirname, "../spec/entailment-corpus.json");

function predicate(source: string): NormalizedPredicate {
  const parsed = parsePredicate(ts, source);
  if (!parsed.ok) throw new Error(parsed.diagnostics[0]?.message);
  return normalizePredicate(ts, parsed.predicate);
}

function holds(sources: readonly string[], value: StaticRuntimeValue): boolean {
  return sources.every((source) => {
    const result = evaluateExpression(predicate(source).expression, { known: true, value });
    return result.known && Boolean(result.value);
  });
}

function encodedSample(value: StaticRuntimeValue): unknown {
  if (typeof value === "number" && !Number.isFinite(value)) {
    return {
      kind: "number",
      value: Number.isNaN(value) ? "NaN" : value === Infinity ? "Infinity" : "-Infinity",
    };
  }
  return value;
}

function formatCorpus(source: string): string {
  const directory = mkdtempSync(resolve(tmpdir(), "ts-refinement-corpus-"));
  const candidate = resolve(directory, "entailment-corpus.json");
  try {
    writeFileSync(candidate, source);
    execFileSync("bunx", ["--no-install", "oxfmt", candidate], {
      cwd: repositoryRoot,
      stdio: "pipe",
    });
    return readFileSync(candidate, "utf8");
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

const current = v.parse(corpusSchema, JSON.parse(readFileSync(corpusPath, "utf8")));
const curated = current.cases.filter((entry) => !entry.name.startsWith(generatedPrefix));
const seen = new Set<string>();
const seenReflexive = new Set<string>();
const candidates: readonly StaticRuntimeValue[] = [
  NaN,
  -Infinity,
  Infinity,
  ...Array.from({ length: 1_025 }, (_, index) => (index - 512) / 4),
];
const generated: Omit<CorpusCase, "name">[] = [];
let negativeCount = 0;
let reflexiveCount = 0;
for (const { source, target } of sample(generatedEntailmentInputs, {
  numRuns: 256,
  seed: 0x5eed,
})) {
  const sourceWitnesses = candidates.filter((candidate) => holds(source, candidate));
  if (sourceWitnesses.length === 0) continue;

  const sourceKey = JSON.stringify(source);
  if (reflexiveCount < 16 && !seenReflexive.has(sourceKey)) {
    seenReflexive.add(sourceKey);
    reflexiveCount += 1;
    generated.push({
      expected: true,
      samples: sourceWitnesses.slice(0, 3).map(encodedSample),
      source,
      target: source,
    });
  }

  const counterexamples = sourceWitnesses.filter((candidate) => !holds(target, candidate));
  if (negativeCount < 48 && counterexamples.length > 0) {
    const key = JSON.stringify({ source, target });
    if (seen.has(key)) continue;
    seen.add(key);
    negativeCount += 1;
    generated.push({
      expected: false,
      samples: counterexamples.slice(0, 3).map(encodedSample),
      source,
      target,
    });
  }
  if (negativeCount === 48 && reflexiveCount === 16) break;
}
if (negativeCount !== 48 || reflexiveCount !== 16) {
  throw new Error(
    `Unable to generate the required corpus cases: ${negativeCount} negative, ${reflexiveCount} reflexive.`,
  );
}
const next: Corpus = {
  cases: [
    ...curated,
    ...generated.map((entry, index) => ({
      ...entry,
      name: `${generatedPrefix}${String(index + 1).padStart(3, "0")}`,
    })),
  ],
  schemaVersion: 1,
};
const output = formatCorpus(`${JSON.stringify(next, null, 2)}\n`);

if (process.argv.includes("--check")) {
  if (readFileSync(corpusPath, "utf8") !== output) {
    throw new Error("Entailment corpus is stale. Run 'bun run corpus:update'.");
  }
} else {
  writeFileSync(corpusPath, output);
}
