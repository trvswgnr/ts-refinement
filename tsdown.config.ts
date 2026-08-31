import { defineConfig } from "tsdown";

export default defineConfig({
  format: ["esm"],
  clean: true,
  sourcemap: true,
  entry: ["src/index.ts"],
  dts: { resolver: "tsc" },
});
