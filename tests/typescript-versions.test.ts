import { describe, expect, it } from "vitest";
import ts57 from "typescript-5-7";
import ts59 from "typescript-5-9";
import ts60 from "typescript";

import {
  analyzeSourceFile,
  filterEntailedRefinementDiagnostics,
  parsePredicate,
} from "@ts-refinement/analyzer";

import { createProgramState } from "../packages/unplugin/src/program.ts";

import { fixtureDirectory, fixtureFile } from "./helpers.ts";

const versions = [ts57, ts59, ts60] as const;
const retainedStructuralDiagnostics = [
  "invalidProperty",
  "invalidOptional",
  "invalidArray",
  "invalidTuple",
  "invalidOptionalTuple",
  "invalidRestTuple",
  "invalidGeneric",
  "invalidUnion",
  "invalidParameter",
  "invalidRecursive",
  "invalidReadonlyArray",
  "invalidOptionalRequired",
  "invalidTupleLength",
  "invalidTupleMember",
  "invalidOptionalToRequiredTuple",
  "invalidRestToFixedTuple",
  "invalidTupleExtra",
  "invalidFixedToRestMember",
];
const retainedIndexDiagnostics = [
  "invalidStringToTemplate",
  "invalidTemplateToString",
  "invalidStringToNumber",
  "invalidNumberToString",
  "invalidTemplateToNarrowTemplate",
  "invalidNarrowTemplateToTemplate",
  "invalidSymbol",
  "invalidNamedToString",
];

describe("supported TypeScript versions", { timeout: 15_000 }, () => {
  for (const tsModule of versions) {
    it(`analyzes refinements with TypeScript ${tsModule.version}`, () => {
      // Each supported compiler has nominally distinct enum types despite the compatible runtime API.
      // SAFETY: the analyzer uses only the shared public API verified by this version-matrix test.
      const compatibleModule = tsModule as typeof ts60;
      const parsed = parsePredicate(compatibleModule, "Number.isInteger(n) && n > 0");
      expect(parsed.ok).toBe(true);

      const state = createProgramState(compatibleModule, {
        cwd: fixtureDirectory,
        tsconfig: "tsconfig.json",
      });
      const sourceFile = state.program.getSourceFile(fixtureFile("valid.ts"));
      if (sourceFile === undefined) throw new Error("fixture was not loaded");

      const results = analyzeSourceFile(state.context, sourceFile);
      expect(results[0]?.proof.kind).toBe("true");
      expect(results[1]?.site.definition?.predicates).toHaveLength(2);
    });

    it(`filters entailment diagnostics with TypeScript ${tsModule.version}`, () => {
      // Each supported compiler has nominally distinct enum types despite the compatible runtime API.
      // SAFETY: the diagnostic filter uses only the shared public API verified by this matrix.
      const compatibleModule = tsModule as typeof ts60;
      const state = createProgramState(compatibleModule, {
        cwd: fixtureDirectory,
        tsconfig: "tsconfig.json",
      });
      for (const [fileName, expected] of [
        ["entailment-structure-matrix.ts", retainedStructuralDiagnostics],
        ["entailment-index-domains.ts", retainedIndexDiagnostics],
      ] as const) {
        const sourceFile = state.program.getSourceFile(fixtureFile(fileName));
        if (sourceFile === undefined)
          throw new Error(`matrix fixture '${fileName}' was not loaded`);

        const diagnostics = filterEntailedRefinementDiagnostics(
          state.context,
          sourceFile,
          state.program.getSemanticDiagnostics(sourceFile),
        );
        expect(
          diagnostics.map((diagnostic) =>
            diagnostic.start === undefined || diagnostic.length === undefined
              ? ""
              : sourceFile.text.slice(diagnostic.start, diagnostic.start + diagnostic.length),
          ),
        ).toEqual(expected);
      }
    });
  }
});
