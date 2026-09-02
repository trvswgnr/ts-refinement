import { createRequire } from "node:module";
import { resolve } from "node:path";

import { rolldown } from "rolldown";
import refinementTypes from "@ts-refinement/rolldown";

const [, , rolldownPackage] = await Promise.all([
  import("ts-refinement"),
  import("@ts-refinement/analyzer"),
  import("@ts-refinement/rolldown"),
  import("@ts-refinement/runtime"),
]);
if (
  !(rolldownPackage.default instanceof Function) ||
  !(rolldownPackage.refinementTypesPlugin instanceof Function)
) {
  throw new TypeError("The Rolldown compatibility exports did not load as plugin factories.");
}

const require = createRequire(import.meta.url);
const typescriptPlugin = require("@ts-refinement/typescript-plugin");
if (!(typescriptPlugin instanceof Function)) {
  throw new TypeError("The TypeScript plugin package did not load as a CommonJS function.");
}

const bundle = await rolldown({
  input: resolve(import.meta.dirname, "refinement-build.ts"),
  plugins: [refinementTypes({ cwd: import.meta.dirname, tsconfig: "tsconfig.json" })],
});
try {
  await bundle.write({ dir: resolve(import.meta.dirname, "dist"), format: "esm" });
} finally {
  await bundle.close();
}
