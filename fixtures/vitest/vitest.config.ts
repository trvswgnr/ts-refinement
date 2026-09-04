import { resolve } from "node:path";

import { defineConfig } from "vitest/config";
import refinementTypes from "@ts-refinement/unplugin/vitest";

const directory = import.meta.dirname;

export default defineConfig({
  plugins: [
    refinementTypes({
      cwd: directory,
      runtimeModule: resolve(directory, "../unplugin/runtime.mjs"),
      tsconfig: "tsconfig.json",
    }),
  ],
  test: {
    include: [resolve(directory, "refinement.test.ts")],
  },
});
