import { defineConfig } from "oxlint";

export default defineConfig({
  options: { typeAware: true },
  categories: {
    correctness: "error",
    perf: "error",
    suspicious: "error",
  },
  env: {
    builtin: true,
    node: true,
  },
  ignorePatterns: [
    "**/node_modules/**",
    "**/dist/**",
    "coverage/**",
    "fixtures/**",
    "vendor/anti-slop/**",
  ],
  jsPlugins: [{ name: "anti-slop", specifier: "./vendor/anti-slop/index.ts" }],
  overrides: [
    {
      // AST dispatch is intentionally exhaustive; splitting the cases would obscure the language model.
      files: ["packages/analyzer/src/predicate/*.ts", "packages/analyzer/src/proof/evaluate.ts"],
      rules: {
        complexity: ["error", 40],
      },
    },
    {
      files: [
        "packages/analyzer/src/predicate/ir.ts",
        "packages/analyzer/src/proof/evaluate.ts",
        "packages/analyzer/src/proof/values.ts",
      ],
      rules: {
        "anti-slop/no-runtime-typeof": "off",
      },
    },
  ],
  plugins: ["typescript", "import"],
  rules: {
    complexity: ["error", 15],
    eqeqeq: "error",
    "import/no-duplicates": "error",
    "no-await-in-loop": "off",
    "no-console": "error",
    "no-unused-vars": "error",
    "require-yield": "off",
    "anti-slop/no-chained-type-assertions": "error",
    "anti-slop/no-conditional-empty-object-spread": "error",
    "anti-slop/no-known-value-widening": "error",
    "anti-slop/no-module-mocking": "error",
    "anti-slop/no-object-parameters": "error",
    "anti-slop/no-reflect-apply": "error",
    "anti-slop/no-reflect-get": "error",
    "anti-slop/no-runtime-typeof": "error",
    "anti-slop/no-shape-in-symbol-names": "error",
    "anti-slop/no-unknown-parameters": "error",
    "anti-slop/no-unknown-returns": "error",
    "anti-slop/no-unknown-type-aliases": "error",
    "anti-slop/no-unsafe-dictionary-type": "error",
    "anti-slop/no-widen-then-assert": "error",
    "anti-slop/require-safety-comment-for-type-assertion": "error",
    "typescript/no-base-to-string": "off",
    "typescript/no-explicit-any": "error",
    "typescript/no-floating-promises": ["error", { ignoreVoid: true }],
    "typescript/no-non-null-assertion": "error",
    "typescript/no-redundant-type-constituents": "off",
    "typescript/no-unnecessary-template-expression": "off",
    "typescript/no-unnecessary-type-arguments": "off",
    "typescript/no-unnecessary-type-assertion": "off",
    "typescript/no-unsafe-type-assertion": "off",
    "typescript/restrict-template-expressions": "off",
    "typescript/unbound-method": "off",
  },
});
