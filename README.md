# ts-refinement

An implementation of refinement assertions for TypeScript that integrates with build tooling and your favorite code editor.

Using VS Code? [Start here](./docs/vscode-quickstart.md).

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
5 as Even; // RF90200 editor diagnostic and build error
dynamic as Even; // unknown statically; a runtime validator is inserted
```

The runtime validator evaluates the original expression once, returns its original value on success, and throws `RefinementError` on failure. Validators are deduplicated by normalized predicate semantics, including across modules in the same build.

The source must already be assignable to the unrefined base type. Refining directly from `unknown`, `any`, or an incompatible type produces RF90101; this project is not a general TypeScript runtime type reifier.

## Installation

```sh
bun add ts-refinement @ts-refinement/runtime
bun add --dev @ts-refinement/cli typescript
```

`ts-refinement` is type-only and has no runtime dependencies. Keep `@ts-refinement/runtime` in regular dependencies because transformed code can import it when the compiler or bundler externalizes package dependencies. `@ts-refinement/cli` verifies final JavaScript on every supported TypeScript generation. Build and editor integrations belong in development dependencies and depend on the compiler generation below.

## Packages

The repository publishes independently installable packages with separate dependency graphs:

- `ts-refinement` - the dependency-free, type-only `Refined<Base, Predicate>` API
- `@ts-refinement/runtime` - the dependency-free `RefinementError` API
- `@ts-refinement/analyzer` - the shared parser, resolver, proof engine, and diagnostics for tooling authors
- `@ts-refinement/cli` - publish-time verification for transformed JavaScript
- `@ts-refinement/unplugin` - shared Vite, Rollup, Rolldown, webpack, Rspack, esbuild, and Farm adapters
- `@ts-refinement/rolldown` - compatibility re-export of the Rolldown adapter
- `@ts-refinement/typescript-plugin` - TypeScript language-service diagnostics
- `@ts-refinement/ttsc` - native TypeScript-Go diagnostics and transforms

Legacy integration packages pin the analyzer implementation they were tested with. The TypeScript plugin remains CommonJS-compatible for tsserver. All packages are released together at the same version, and integration peer dependencies require the matching core and runtime versions.

## Project setup

TypeScript 5.7 through 6.x uses `tspc` with the Program Transformer:

```sh
bun add --dev @ts-refinement/typescript-plugin @ts-refinement/unplugin ts-patch tsdown
```

```json
{
  "scripts": {
    "build": "tsdown",
    "check": "tspc --noEmit",
    "prepack": "bun run build && ts-refinement verify dist"
  },
  "compilerOptions": {
    "plugins": [
      {
        "transform": "@ts-refinement/typescript-plugin/transformer",
        "transformProgram": true
      }
    ]
  }
}
```

TypeScript 7 and newer uses `ttsc` with native check and transform stages:

```sh
bun add --dev @ts-refinement/ttsc ttsc
```

```json
{
  "scripts": {
    "build": "ttsc build --emit",
    "check": "ttsc check"
  },
  "compilerOptions": {
    "plugins": [
      { "transform": "@ts-refinement/ttsc/check" },
      { "transform": "@ts-refinement/ttsc/transform" }
    ]
  }
}
```

Bare `tsc` carries the branded types but cannot delegate predicate implication to the analyzer. Use `tspc` on TypeScript 5.7 through 6.x or `ttsc` on TypeScript 7 and newer.

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

The plugin creates one TypeScript Program per build generation and retains it across module transforms. Source and config watch events invalidate the cached generation before the next build.

Unplugin write builds and native `ttsc build --emit` builds emit `.ts-refinement-manifest.json` in the output directory. Publishable packages that expose refinements must run `ts-refinement verify dist` directly from `prepack`; the verifier checks final JavaScript digests and every runtime-required assertion marker.

## Editor setup

TypeScript 5.7 through 6.x uses the language-service plugin:

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

VS Code may need to be switched to the workspace TypeScript version. The language-service plugin adds editor diagnostics while `tspc` owns CI diagnostics.

TypeScript 7 and newer uses the [ttsc VS Code extension](https://ttsc.dev/docs/setup/vscode):

```sh
npx @ttsc/vscode
```

The extension reads the workspace's `ttsc`, TypeScript, and plugin configuration. The `@ts-refinement/ttsc` check plugin supplies editor diagnostics and quick fixes as well as CI diagnostics.

## Predicate rules

Predicates are parsed as JavaScript expressions. The compile-time analyzer interprets normalized IR and never executes predicate JavaScript. When an assertion requires a runtime check, the adapter compiles its predicate into JavaScript that executes in the consumer bundle. Treat predicate text as runtime code whenever static proof is inconclusive. Accepted syntax outside the runtime IR reports RF90004 instead of emitting source text.

This initial implementation permits the inferred subject, standard ECMAScript globals, and locally bound identifiers. It rejects malformed expressions, assignments, updates, `await`, `yield`, dynamic imports, and ambiguous free identifiers. Node and browser globals such as `Buffer`, `process`, `window`, and `document` are not implicit standard globals.

Module-level `const` values with primitive literal initializers can be captured in predicates. The analyzer folds them into literal IR before proof and runtime compilation. Mutable, broad, object, array, function, ambient, dynamic, or unresolved captures produce RF90003.

The initial proof engine handles primitive and array literals, trivial unary expressions, arithmetic, comparisons, strict equality, logical/nullish operations, conditionals, primitive `.length`, `Number.isInteger`, and `Number.isFinite`. Runtime predicates remain normal JavaScript, so regular expressions, array methods, and other ordinary operations work without becoming a separate refinement DSL.

## Diagnostics

| Code    | Severity | Meaning                                             |
| ------- | -------- | --------------------------------------------------- |
| RF90000 | error    | Invalid or disallowed JavaScript expression         |
| RF90001 | error    | Predicate is not a concrete string literal          |
| RF90002 | error    | Subject cannot be inferred unambiguously            |
| RF90003 | error    | Predicate attempts a disallowed external capture    |
| RF90004 | error    | Predicate syntax cannot be compiled from runtime IR |
| RF90101 | error    | Source is not assignable to the unrefined base type |
| RF90200 | error    | Predicate is statically disproven                   |
| RF90400 | error    | Refinement metadata cannot be resolved              |
| RF90500 | warning  | Exported refinement lacks publish verification      |

RF90500 points to a public declaration whose nearest non-private package lacks matching `ts-refinement.verify.outDir` configuration and a direct `ts-refinement verify OUTDIR` command in `prepack`. It remains a warning in the initial release and is planned to become an error in `0.3`; severity is fixed by the diagnostic contract, not inferred from the installed package version.

## Development

This repository is a Bun workspace that publishes eight npm packages.

- TypeScript 5.7 through 6.x is supported through `tspc` and the TypeScript language-service plugin.
- TypeScript 7 and newer is supported through the native `ttsc` check, transform, and LSP sidecar.

New compiler integration work lands on the `ttsc` path first. The TypeScript 5.7 through 6.x path remains supported for projects that depend on the classic compiler API.

```sh
bun install
bun run gate
```

`gate` runs type checking, linting, formatting verification, the analyzer/build/runtime/language-service tests, all package builds, and the tsdown example build.
