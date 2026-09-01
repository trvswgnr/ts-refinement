import { createRequire } from "node:module";

await Promise.all([
  import("ts-refinement"),
  import("@ts-refinement/analyzer"),
  import("@ts-refinement/rolldown"),
  import("@ts-refinement/runtime"),
]);

const require = createRequire(import.meta.url);
const typescriptPlugin = require("@ts-refinement/typescript-plugin");
if (!(typescriptPlugin instanceof Function)) {
  throw new TypeError("The TypeScript plugin package did not load as a CommonJS function.");
}
