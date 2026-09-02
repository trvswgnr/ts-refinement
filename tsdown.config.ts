import { defineConfig, type UserConfig } from "tsdown";

import refinementTypes from "./packages/unplugin/src/rolldown.ts";

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
    plugins: [refinementTypes()],
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
    entry: [
      "packages/unplugin/src/index.ts",
      "packages/unplugin/src/vite.ts",
      "packages/unplugin/src/vitest.ts",
      "packages/unplugin/src/loader.ts",
      "packages/unplugin/src/rollup.ts",
      "packages/unplugin/src/rolldown.ts",
      "packages/unplugin/src/webpack.ts",
      "packages/unplugin/src/rspack.ts",
      "packages/unplugin/src/esbuild.ts",
      "packages/unplugin/src/farm.ts",
    ],
    name: "unplugin",
    outDir: "packages/unplugin/dist",
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
    entry: [
      "packages/typescript-plugin/src/index.ts",
      "packages/typescript-plugin/src/transformer.ts",
    ],
    format: ["cjs"],
    name: "typescript-plugin",
    outDir: "packages/typescript-plugin/dist",
  },
  {
    ...shared,
    entry: [
      "packages/ttsc-plugin/src/index.ts",
      "packages/ttsc-plugin/src/check.ts",
      "packages/ttsc-plugin/src/transform.ts",
    ],
    name: "ttsc-plugin",
    outDir: "packages/ttsc-plugin/dist",
  },
]);
