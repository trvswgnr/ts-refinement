import { describe, expect, it } from "vitest";
import ts57 from "typescript-5-7";
import ts59 from "typescript-5-9";
import ts60 from "typescript";

import { analyzeSourceFile, parsePredicate } from "@ts-refinement/analyzer";

import { createProgramState } from "../packages/unplugin/src/program.ts";

import { fixtureDirectory, fixtureFile } from "./helpers.ts";

const versions = [ts57, ts59, ts60] as const;

describe("supported TypeScript versions", () => {
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
  }
});
