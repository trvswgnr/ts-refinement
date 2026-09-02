# ts-refinement

An implementation of refinement assertions for TypeScript that integrates with build tooling and your favorite code editor.

Using VSCode? [Start here](./docs/vscode-quickstart.md).

A refinement attaches a predicate to an existing type:

```ts
import type { Refined } from "ts-refinement";

type Positive = Refined<number, "n > 0">;
type Int = Refined<number, "Number.isInteger(n)">;
type Even = Refined<Int, "n % 2 === 0">;
```

The subject name is inferred. `"n > 0"`, `"value > 0"`, and `"potato > 0"` have the same normalized meaning to the analyzer, as do whitespace-only changes. Bare TypeScript still sees the original predicate strings as different brand keys and cannot prove their equivalence.

## Assertion behavior

```ts
declare const dynamic: number;

4 as Even; // proved valid; the assertion is erased
5 as Even; // RF1200 editor diagnostic and build error
dynamic as Even; // unknown statically; a runtime validator is inserted
```

The runtime validator evaluates the original expression once, returns its original value on success, and throws `RefinementError` on failure. Validators are deduplicated by normalized predicate semantics, including across modules in the same build.

The source must already be assignable to the unrefined base type. Refining directly from `unknown`, `any`, or an incompatible type produces RF1101; this project is not a general TypeScript runtime type reifier.

## Installation

```sh
bun add ts-refinement @ts-refinement/runtime
bun add --dev @ts-refinement/unplugin @ts-refinement/cli @ts-refinement/typescript-plugin typescript tsdown
```

`ts-refinement` is type-only and has no runtime dependencies. Keep `@ts-refinement/runtime` in regular dependencies because transformed code can import it when the bundler externalizes package dependencies. Build and editor integrations belong in development dependencies.

## Packages

The repository publishes independently installable packages with separate dependency graphs:

- `ts-refinement` - the dependency-free, type-only `Refined<Base, Predicate>` API
- `@ts-refinement/runtime` - the dependency-free `RefinementError` API
- `@ts-refinement/analyzer` - the shared parser, resolver, proof engine, and diagnostics for tooling authors
- `@ts-refinement/cli` - the refinement-aware `ts-refinement check` command
- `@ts-refinement/unplugin` - shared Vite, Rollup, Rolldown, webpack, Rspack, esbuild, and Farm adapters
- `@ts-refinement/rolldown` - compatibility re-export of the Rolldown adapter
- `@ts-refinement/typescript-plugin` - TypeScript language-service diagnostics

The integration packages bundle the analyzer implementation they were tested with. This keeps the TypeScript plugin CommonJS-compatible and prevents ordinary users from installing the standalone analyzer package. All packages are released together at the same version, and integration peer dependencies require the matching core and runtime versions.

## Project setup

Use the refinement-aware checker in CI instead of bare `tsc --noEmit`:

```json
{
  "scripts": {
    "build": "tsdown",
    "check": "ts-refinement check",
    "prepack": "bun run build && ts-refinement verify dist"
  },
  "ts-refinement": {
    "verify": {
      "outDir": "dist"
    }
  }
}
```

Bare `tsc` carries the branded types but cannot delegate predicate implication to the analyzer. An inconclusive ordinary assignment therefore remains a TypeScript error unless it is checked by `ts-refinement check`.

Runtime safety for unknown assertion sites requires one of the supported unplugin adapters. For tsdown, use the Rolldown adapter:

```ts
// tsdown.config.ts
import { defineConfig } from "tsdown";
import refinementTypes from "@ts-refinement/unplugin/rolldown";

export default defineConfig({
  entry: ["src/index.ts"],
  plugins: [refinementTypes()],
  sourcemap: true,
});
```

The plugin uses the closest `tsconfig.json` by default. An explicit path and runtime module can be supplied when needed:

```ts
refinementTypes({
  tsconfig: "./tsconfig.build.json",
  runtimeModule: "@ts-refinement/runtime",
});
```

The plugin recreates its TypeScript program at each build start and watches the tsconfig plus every source/type-definition file in the program. This favors correct watch rebuilds over premature incremental complexity.

Write builds emit `dist/.ts-refinement-manifest.json`. Publishable packages that expose refinements must run `ts-refinement verify dist` directly from `prepack`; the verifier checks final JavaScript digests and every runtime-required assertion marker.

## Editor setup

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "@ts-refinement/typescript-plugin"
      }
    ]
  }
}
```

VS Code may need to be switched to the workspace TypeScript version. The language-service plugin adds editor diagnostics only. `ts-refinement check` owns CI diagnostics, the unplugin adapter transforms builds, and `ts-refinement verify` validates publish output.

## Predicate rules

Predicates are parsed as JavaScript expressions. The compile-time analyzer interprets normalized IR and never executes predicate JavaScript. When an assertion requires a runtime check, the adapter compiles its predicate into JavaScript that executes in the consumer bundle. Treat predicate text as runtime code whenever static proof is inconclusive. Accepted syntax outside the runtime IR reports RF1004 instead of emitting source text.

This initial implementation permits the inferred subject, standard ECMAScript globals, and locally bound identifiers. It rejects malformed expressions, assignments, updates, `await`, `yield`, dynamic imports, and ambiguous free identifiers. Node and browser globals such as `Buffer`, `process`, `window`, and `document` are not implicit standard globals.

Module-level `const` values with primitive literal initializers can be captured in predicates. The analyzer folds them into literal IR before proof and runtime compilation. Mutable, broad, object, array, function, ambient, dynamic, or unresolved captures produce RF1003.

The initial proof engine handles primitive and array literals, trivial unary expressions, arithmetic, comparisons, strict equality, logical/nullish operations, conditionals, primitive `.length`, `Number.isInteger`, and `Number.isFinite`. Runtime predicates remain normal JavaScript, so regular expressions, array methods, and other ordinary operations work without becoming a separate refinement DSL.

## Diagnostics

| Code   | Severity | Meaning                                             |
| ------ | -------- | --------------------------------------------------- |
| RF1000 | error    | Invalid or disallowed JavaScript expression         |
| RF1001 | error    | Predicate is not a concrete string literal          |
| RF1002 | error    | Subject cannot be inferred unambiguously            |
| RF1003 | error    | Predicate attempts a disallowed external capture    |
| RF1004 | error    | Predicate syntax cannot be compiled from runtime IR |
| RF1101 | error    | Source is not assignable to the unrefined base type |
| RF1200 | error    | Predicate is statically disproven                   |
| RF1400 | error    | Refinement metadata cannot be resolved              |
| RF1500 | warning  | Exported refinement lacks publish verification      |

RF1500 points to a public declaration whose nearest non-private package lacks matching `ts-refinement.verify.outDir` configuration and a direct `ts-refinement verify OUTDIR` command in `prepack`. It remains a warning in the initial release and is planned to become an error in `0.3`; severity is fixed by the diagnostic contract, not inferred from the installed package version.

## Development

This repository is a Bun workspace that publishes seven npm packages. TypeScript 5.7 through 6.x is supported. TypeScript 7's native compiler does not expose the classic `Program`/`TypeChecker` and tsserver APIs required by the current analyzer; support requires an upstream-compatible compiler API or a future analyzer integration and is not currently claimed.

```sh
bun install
bun run gate
```

`gate` runs type checking, linting, formatting verification, the analyzer/build/runtime/language-service tests, and all package builds.
