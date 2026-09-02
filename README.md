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

The subject name is inferred. `"n > 0"`, `"value > 0"`, and `"potato > 0"` have the same normalized meaning.

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
bun add --dev @ts-refinement/unplugin @ts-refinement/cli @ts-refinement/typescript-plugin typescript
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

## tsdown setup

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

VS Code may need to be switched to the workspace TypeScript version. The language-service plugin adds refinement diagnostics; normal `tsc` does not run language-service plugins or perform the runtime transform.

## Predicate rules

Predicates are parsed as JavaScript expressions. The compiler never executes predicate JavaScript. The static interpreter only evaluates operations it explicitly models; inconclusive expressions represented by the normalized runtime IR fall back to runtime validation. Accepted syntax outside that IR reports RF1004 instead of emitting source text.

This initial implementation permits the inferred subject, standard ECMAScript globals, and locally bound identifiers. It rejects malformed expressions, assignments, updates, `await`, `yield`, dynamic imports, and ambiguous free identifiers. Node and browser globals such as `Buffer`, `process`, `window`, and `document` are not implicit standard globals.

The initial proof engine handles primitive and array literals, trivial unary expressions, arithmetic, comparisons, strict equality, logical/nullish operations, conditionals, primitive `.length`, `Number.isInteger`, and `Number.isFinite`. Runtime predicates remain normal JavaScript, so regular expressions, array methods, and other ordinary operations work without becoming a separate refinement DSL.

## Diagnostics

| Code   | Meaning                                             |
| ------ | --------------------------------------------------- |
| RF1000 | Invalid or disallowed JavaScript expression         |
| RF1001 | Predicate is not a concrete string literal          |
| RF1002 | Subject cannot be inferred unambiguously            |
| RF1003 | Predicate attempts a disallowed external capture    |
| RF1004 | Predicate syntax cannot be compiled from runtime IR |
| RF1101 | Source is not assignable to the unrefined base type |
| RF1200 | Predicate is statically disproven                   |
| RF1400 | Refinement metadata cannot be resolved              |

## Development

This repository is a Bun workspace that publishes seven npm packages. TypeScript 5.7 through 6.x is supported; TypeScript 7's native compiler package does not expose the classic `Program`/`TypeChecker` and tsserver plugin APIs required by this initial implementation.

```sh
bun install
bun run gate
```

`gate` runs type checking, linting, formatting verification, the analyzer/build/runtime/language-service tests, and all package builds.
