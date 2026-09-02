# @ts-refinement/unplugin

One refinement transform for Vite, Rollup, Rolldown, webpack, Rspack, esbuild, and Farm.
This analyzer-backed integration supports TypeScript 5.7 through 6.x. TypeScript 7 and newer uses
the native `@ts-refinement/ttsc` transform.

```sh
npm install --save-dev @ts-refinement/unplugin typescript
npm install ts-refinement @ts-refinement/runtime
```

Import the adapter for the active bundler:

```ts
import refinementTypes from "@ts-refinement/unplugin/vite";

export default {
  plugins: [refinementTypes()],
};
```

The adapter entry points are `vite`, `rollup`, `rolldown`, `webpack`, `rspack`, `esbuild`, and
`farm`. Every adapter accepts the same options:

```ts
interface RefinementTypesPluginOptions {
  cwd?: string;
  tsconfig?: string;
  runtimeModule?: string;
  ignore?: readonly string[];
}
```

The plugin analyzes the exact source supplied by the bundler, emits runtime checks for
inconclusive assertions, preserves source maps, and fails builds on refinement diagnostics.
Successful write builds also emit `.ts-refinement-manifest.json` after final JavaScript assets
exist. Run `ts-refinement verify OUTDIR` from `prepack` to validate its digests and runtime site
markers.

The compile-time analyzer never executes predicate JavaScript. Predicates for inconclusive
assertions are compiled from normalized IR and execute in the consumer bundle. Primitive literal
module captures are folded into generated code; rejected captures report RF90003.

Farm 1.7 emits a source-map asset but currently drops transform mappings, including mappings from
passthrough plugins without ts-refinement. The Farm adapter forwards its transform map; source
identity in Farm output depends on the compiler restoring transform-map composition.

## Vitest

Use the Vitest entry point when tests execute TypeScript through Vite's transform pipeline:

```ts
import { defineConfig } from "vitest/config";
import refinementTypes from "@ts-refinement/unplugin/vitest";

export default defineConfig({
  plugins: [refinementTypes()],
});
```

## Node loader

Use the loader when Node executes TypeScript directly:

```sh
node --loader @ts-refinement/unplugin/loader src/index.ts
```

The loader discovers `tsconfig.json` from the current directory. Set `TS_REFINEMENT_CWD` or
`TS_REFINEMENT_TSCONFIG` to override project discovery, and set `TS_REFINEMENT_RUNTIME_MODULE` when
the transformed code should import `RefinementError` from a custom module.
