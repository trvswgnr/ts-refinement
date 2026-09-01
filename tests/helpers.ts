import { resolve } from "node:path";

import ts from "typescript";

import { createProgramState } from "../packages/rolldown-plugin/src/program.ts";

export const fixtureDirectory = resolve(import.meta.dirname, "../fixtures/analysis");

export function fixtureProgram() {
  return createProgramState(ts, {
    cwd: fixtureDirectory,
    tsconfig: "tsconfig.json",
  });
}

export function fixtureFile(name: string): string {
  return resolve(fixtureDirectory, name);
}
