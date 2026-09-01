import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "ts-refinement-types/analyzer",
        replacement: `${root}packages/analyzer/src/index.ts`,
      },
      {
        find: "ts-refinement-types/rolldown",
        replacement: `${root}packages/rolldown-plugin/src/index.ts`,
      },
      {
        find: "ts-refinement-types/runtime",
        replacement: `${root}packages/runtime/src/index.ts`,
      },
      { find: /^ts-refinement-types$/u, replacement: `${root}packages/core/src/index.ts` },
    ],
  },
  test: {
    coverage: {
      include: ["packages/*/src/**/*.ts"],
      reporter: ["text", "json", "html", "lcov"],
      reportsDirectory: "coverage",
      thresholds: {
        branches: 70,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
    include: ["tests/**/*.test.ts"],
  },
});
