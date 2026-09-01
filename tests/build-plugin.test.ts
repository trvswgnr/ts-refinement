import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";
import { rolldown } from "rolldown";
import { describe, expect, it } from "vitest";

import { refinementTypesPlugin } from "ts-refinement-types/rolldown";
import { fixtureDirectory, fixtureFile } from "./helpers.ts";

interface RuntimeFixture {
  readonly checkAllPositive: (value: number[]) => number[];
  readonly checkConflicting: (value: number) => number;
  readonly checkEven: (value: number) => number;
  readonly checkFromFactory: (factory: () => number) => number;
  readonly checkOther: (value: number) => number;
  readonly checkPositive: (value: number) => number;
  readonly checkSlug: (value: string) => string;
  readonly knownGood: number;
  readonly knownNonEmpty: string;
}

function generatedPosition(code: string, offset: number) {
  const precedingLines = code.slice(0, offset).split("\n");
  return {
    column: precedingLines.at(-1)?.length ?? 0,
    line: precedingLines.length,
  };
}

async function build(input: string) {
  return rolldown({
    input,
    plugins: [
      refinementTypesPlugin({
        cwd: fixtureDirectory,
        runtimeModule: fixtureFile("../../packages/runtime/src/index.ts"),
        tsconfig: "tsconfig.json",
      }),
    ],
  });
}

describe("Rolldown plugin", () => {
  it("runs the full static/runtime pipeline and evaluates sources once", async () => {
    const bundle = await build(fixtureFile("runtime-entry.ts"));
    const generated = await bundle.generate({ format: "esm", sourcemap: true });
    const chunk = generated.output.find((output) => output.type === "chunk");
    if (chunk === undefined) throw new Error("bundle did not emit a chunk");

    if (chunk.map === null) throw new Error("bundle did not emit a source map");
    expect(chunk.map.sources.some((source) => source.endsWith("runtime-entry.ts"))).toBe(true);
    expect(chunk.map.sourcesContent?.some((source) => source?.includes("checkPositive"))).toBe(
      true,
    );
    const checkPositiveStart = chunk.code.indexOf("function checkPositive");
    const validationCall = chunk.code.indexOf("return ", checkPositiveStart) + "return ".length;
    const original = originalPositionFor(
      new TraceMap(JSON.stringify(chunk.map)),
      generatedPosition(chunk.code, validationCall),
    );
    expect(original.source?.endsWith("runtime-entry.ts")).toBe(true);
    expect(original.line).toBe(9);
    expect(chunk.code.match(/function assert/gu)).toHaveLength(5);
    expect(chunk.code).not.toContain("5 as Positive");

    const moduleUrl = `data:text/javascript;base64,${Buffer.from(chunk.code).toString("base64")}#${Date.now()}`;
    // SAFETY: Rolldown generated this module from the typed runtime fixture declared above.
    const fixture = (await import(moduleUrl)) as RuntimeFixture;
    expect(fixture.knownGood).toBe(5);
    expect(fixture.knownNonEmpty).toBe("a");
    expect(fixture.checkPositive(2)).toBe(2);
    expect(fixture.checkOther(3)).toBe(3);
    expect(() => fixture.checkOther(-3)).toThrowError(
      expect.objectContaining({ refinement: "PositiveByValue", value: -3 }),
    );
    expect(() => fixture.checkPositive(-1)).toThrowError(
      expect.objectContaining({ name: "RefinementError", predicate: "n > 0", value: -1 }),
    );
    expect(fixture.checkEven(4)).toBe(4);
    expect(() => fixture.checkEven(5)).toThrowError(
      expect.objectContaining({ name: "RefinementError", value: 5 }),
    );
    expect(fixture.checkSlug("valid-slug")).toBe("valid-slug");
    expect(() => fixture.checkSlug("Not a slug")).toThrowError(
      expect.objectContaining({ name: "RefinementError", value: "Not a slug" }),
    );
    expect(fixture.checkAllPositive([1, 2, 3])).toEqual([1, 2, 3]);
    expect(() => fixture.checkAllPositive([1, -2, 3])).toThrowError(
      expect.objectContaining({ name: "RefinementError" }),
    );
    expect(() => fixture.checkConflicting(2)).toThrowError(
      expect.objectContaining({ refinement: "Negative" }),
    );
    expect(() => fixture.checkConflicting(-2)).toThrowError(
      expect.objectContaining({ refinement: "Positive" }),
    );

    let calls = 0;
    expect(
      fixture.checkFromFactory(() => {
        calls += 1;
        return 6;
      }),
    ).toBe(6);
    expect(calls).toBe(1);
  });

  it("fails the build for a statically false assertion", async () => {
    const bundle = await build(fixtureFile("build-invalid.ts"));
    await expect(bundle.generate({ format: "esm" })).rejects.toThrow(/RF1200/u);
  });
});
