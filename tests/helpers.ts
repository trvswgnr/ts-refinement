import { resolve } from "node:path";

import ts from "typescript";

import { createProgramState } from "../packages/unplugin/src/program.ts";

export const fixtureDirectory = resolve(import.meta.dirname, "../fixtures/analysis");

export function projectProgram(cwd: string) {
  return createProgramState(ts, {
    cwd,
    tsconfig: "tsconfig.json",
  });
}

export function fixtureProgram() {
  return projectProgram(fixtureDirectory);
}

export function fixtureFile(name: string): string {
  return resolve(fixtureDirectory, name);
}
