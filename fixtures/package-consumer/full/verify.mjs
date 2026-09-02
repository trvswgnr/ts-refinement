import { createRequire } from "node:module";

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
