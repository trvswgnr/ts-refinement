import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      include: ["src/**/*.ts"],
      reporter: ["text", "json", "html", "lcov"],
      reportsDirectory: "coverage",
    },
    exclude: ["tests/**"],
    include: ["tests/**/*.test.ts"],
    typecheck: {
      enabled: true,
      include: ["tests/**/*.test.ts"],
    },
  },
});
