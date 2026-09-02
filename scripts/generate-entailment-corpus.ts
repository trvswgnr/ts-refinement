import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { sample } from "fast-check";
import ts from "typescript";
import * as v from "valibot";

import {
  entails,
  normalizePredicate,
  parsePredicate,
  type NormalizedPredicate,
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
const generated = sample(generatedEntailmentInputs, { numRuns: 64, seed: 0x5eed }).flatMap(
  ({ source, target }): readonly Omit<CorpusCase, "name">[] => {
    const key = JSON.stringify({ source, target });
    if (seen.has(key)) return [];
    seen.add(key);
    return [
      {
        expected: entails(source.map(predicate), target.map(predicate)),
        samples: [],
        source,
        target,
      },
    ];
  },
);
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
