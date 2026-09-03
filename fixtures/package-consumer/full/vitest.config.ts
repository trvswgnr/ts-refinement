import { defineConfig } from "vitest/config";

import refinementTypes from "@ts-refinement/unplugin/vitest";

export default defineConfig({
  plugins: [refinementTypes({ cwd: import.meta.dirname, tsconfig: "tsconfig.json" })],
  test: { include: ["runner.test.ts"] },
});
