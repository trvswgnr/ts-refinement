# VS Code quickstart

TypeScript 5.7 through 6.x uses `tspc` and the classic TypeScript language service. TypeScript 7 and newer uses `ttsc` and its VS Code extension. Both paths transform runtime assertions and support publish verification.

## Install

```sh
bun add ts-refinement @ts-refinement/runtime
bun add --dev @ts-refinement/cli typescript
```

`ts-refinement` is declaration-only. Keep `@ts-refinement/runtime` in regular dependencies because transformed code can import it. The CLI verifies final output and works with either compiler generation.

## TypeScript 5.7 through 6.x

```sh
bun add --dev @ts-refinement/typescript-plugin @ts-refinement/unplugin ts-patch tsdown
```

Register both the editor plugin and the Program Transformer:

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "@ts-refinement/typescript-plugin"
      },
      {
        "transform": "@ts-refinement/typescript-plugin/transformer",
        "transformProgram": true
      }
    ]
  }
}
```

Run `TypeScript: Select TypeScript Version` from the VS Code command palette and choose `Use Workspace Version`. Restart the TypeScript server if diagnostics do not appear.

```json
{
  "scripts": {
    "check": "tspc --noEmit"
  }
}
```

Bare `tsc` carries refinement brands but cannot ask the analyzer whether one predicate implies another. `tspc` preserves ordinary TypeScript errors, discharges proven refinement implication, and adds RF diagnostics.

## TypeScript 7 and newer

```sh
bun add --dev @ts-refinement/ttsc ttsc
npx @ttsc/vscode
```

The second command installs the `ttsc` VS Code extension. Register the native check and transform stages:

```json
{
  "compilerOptions": {
    "plugins": [
      { "transform": "@ts-refinement/ttsc/check" },
      { "transform": "@ts-refinement/ttsc/transform" }
    ]
  }
}
```

```json
{
  "scripts": {
    "build": "ttsc build --emit",
    "check": "ttsc check"
  }
}
```

The extension reads the workspace's `ttsc`, TypeScript, and plugin configuration. It shows native refinement diagnostics and offers a quick fix for statically disproven assertions.

## Build transformation

On TypeScript 5.7 through 6.x, unknown assertion sites need a supported adapter to insert runtime checks. Configure the Rolldown adapter for tsdown:

```ts
import { defineConfig } from "tsdown";
import refinementTypes from "@ts-refinement/unplugin/rolldown";

export default defineConfig({
  entry: ["src/index.ts"],
  plugins: [refinementTypes()],
  sourcemap: true,
});
```

The same package exposes `vite`, `rollup`, `webpack`, `rspack`, `esbuild`, and `farm` adapter entry points. Each adapter accepts `cwd`, `tsconfig`, `runtimeModule`, and `ignore` options. TypeScript 7 projects use the native `ttsc` transform configured above.

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

The build adapter and `ttsc build --emit` write `.ts-refinement-manifest.json` after final assets exist. The verifier checks asset digests and every runtime-required site marker. RF90500 warns when a public refinement lacks matching configuration and a direct `prepack` verifier command. RF90500 is a warning in the initial release and is planned to become an error in `0.3`.

## Use refinements

```ts
import type { Refined } from "ts-refinement";

const MINIMUM = 0 as const;

type Positive = Refined<number, "n > MINIMUM">;
type Int = Refined<number, "Number.isInteger(n)">;
type Even = Refined<Int, "n % 2 === 0">;

declare const dynamic: number;

4 as Even; // proved and erased
5 as Even; // RF90200 in the editor, checker, and build
dynamic as Even; // runtime validator inserted by the build adapter
```

Subject renaming and whitespace are normalized by the analyzer, but bare TypeScript still sees the original predicate strings as distinct brand keys. Primitive literal module constants such as `MINIMUM` are folded into normalized predicates; rejected captures produce RF90003.

The compile-time analyzer never executes predicate JavaScript. A predicate needed at runtime is compiled into the consumer bundle and executes there when its assertion is checked.
