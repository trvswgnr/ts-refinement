import { defineConfig } from "tsdown";

import refinementTypes from "@ts-refinement/rolldown";

export default defineConfig({
  entry: ["src/index.ts"],
  plugins: [refinementTypes()],
  sourcemap: true,
});
