import { defineConfig, type UserConfig } from "tsdown";

const shared = {
  clean: true,
  deps: {
    dts: { neverBundle: true },
    neverBundle: true,
  },
  dts: { resolver: "tsc" },
  fixedExtension: true,
  format: ["esm"],
  platform: "node",
  sourcemap: true,
  target: "node20",
} satisfies UserConfig;

export default defineConfig([
  {
    ...shared,
    entry: ["packages/core/src/index.ts"],
    name: "core",
    outDir: "packages/core/dist",
  },
  {
    ...shared,
    entry: ["packages/analyzer/src/index.ts"],
    name: "analyzer",
    outDir: "packages/analyzer/dist",
  },
  {
    ...shared,
    entry: ["packages/cli/src/cli.ts", "packages/cli/src/index.ts"],
    name: "cli",
    outDir: "packages/cli/dist",
  },
  {
    ...shared,
    entry: ["packages/runtime/src/index.ts"],
    name: "runtime",
    outDir: "packages/runtime/dist",
  },
  {
    ...shared,
    entry: ["packages/rolldown-plugin/src/index.ts"],
    name: "rolldown-plugin",
    outDir: "packages/rolldown-plugin/dist",
  },
  {
    ...shared,
    cjsDefault: true,
    entry: ["packages/typescript-plugin/src/index.ts"],
    format: ["cjs"],
    name: "typescript-plugin",
    outDir: "packages/typescript-plugin/dist",
  },
]);
