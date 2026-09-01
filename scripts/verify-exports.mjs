import { createRequire } from "node:module";

const esmEntryPoints = [
  "ts-refinement-types",
  "ts-refinement-types/analyzer",
  "ts-refinement-types/rolldown",
  "ts-refinement-types/runtime",
];

await Promise.all(esmEntryPoints.map((entryPoint) => import(entryPoint)));

const require = createRequire(import.meta.url);
const typescriptPlugin = require("ts-refinement-types/typescript-plugin");
if (!(typescriptPlugin instanceof Function)) {
  throw new TypeError("The TypeScript plugin entry point did not load as a CommonJS function.");
}
