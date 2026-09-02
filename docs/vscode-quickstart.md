# VS Code quickstart

This guide uses Bun, tsdown, and TypeScript 5.7 through 6.x. TypeScript 7's native compiler does not expose the classic analyzer and tsserver APIs required by the current integrations, so it is not supported yet.

## Install

```sh
bun add ts-refinement @ts-refinement/runtime
bun add --dev @ts-refinement/cli @ts-refinement/unplugin @ts-refinement/typescript-plugin typescript tsdown
```

`ts-refinement` is declaration-only. Keep `@ts-refinement/runtime` in regular dependencies because transformed code can import it.

## Editor diagnostics

Add the language-service plugin to `tsconfig.json`:

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

Run `TypeScript: Select TypeScript Version` from the VS Code command palette and choose `Use Workspace Version`. Restart the TypeScript server if diagnostics do not appear.

The plugin provides editor diagnostics. It does not change `tsc`, transform emitted JavaScript, or verify package output.

## CI checking

Use the refinement-aware checker instead of `tsc --noEmit`:

```json
{
  "scripts": {
    "check": "ts-refinement check"
  }
}
```

Bare TypeScript carries refinement brands but cannot ask the analyzer whether one predicate implies another. `ts-refinement check` preserves ordinary TypeScript errors, applies proven refinement implication, and adds RF diagnostics.

## Build transformation

Unknown assertion sites need a supported adapter to insert runtime checks. Configure the Rolldown adapter for tsdown:

```ts
import { defineConfig } from "tsdown";
import refinementTypes from "@ts-refinement/unplugin/rolldown";

export default defineConfig({
  entry: ["src/index.ts"],
  plugins: [refinementTypes()],
  sourcemap: true,
});
```

The same package exposes `vite`, `rollup`, `webpack`, `rspack`, `esbuild`, and `farm` adapter entry points. Each adapter accepts `cwd`, `tsconfig`, `runtimeModule`, and `ignore` options.

## Publish verification

Publishable packages that expose refinements must validate the final JavaScript from `prepack`:

```json
{
  "scripts": {
    "build": "tsdown",
    "prepack": "bun run build && ts-refinement verify dist"
  },
  "ts-refinement": {
    "verify": {
      "outDir": "dist"
    }
  }
}
```

The build adapter writes `.ts-refinement-manifest.json` after final assets exist. The verifier checks asset digests and every runtime-required site marker. RF1500 warns when a public refinement lacks matching configuration and a direct `prepack` verifier command. RF1500 is a warning in the initial release and is planned to become an error in `0.3`.

## Use refinements

```ts
import type { Refined } from "ts-refinement";

const MINIMUM = 0 as const;

type Positive = Refined<number, "n > MINIMUM">;
type Int = Refined<number, "Number.isInteger(n)">;
type Even = Refined<Int, "n % 2 === 0">;

declare const dynamic: number;

4 as Even; // proved and erased
5 as Even; // RF1200 in the editor, checker, and build
dynamic as Even; // runtime validator inserted by the build adapter
```

Subject renaming and whitespace are normalized by the analyzer, but bare TypeScript still sees the original predicate strings as distinct brand keys. Primitive literal module constants such as `MINIMUM` are folded into normalized predicates; rejected captures produce RF1003.

The compile-time analyzer never executes predicate JavaScript. A predicate needed at runtime is compiled into the consumer bundle and executes there when its assertion is checked.
