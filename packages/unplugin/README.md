# @ts-refinement/unplugin

One refinement transform for Vite, Rollup, Rolldown, webpack, Rspack, esbuild, and Farm.

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

Farm 1.7 emits a source-map asset but currently drops transform mappings, including mappings from
passthrough plugins without ts-refinement. The Farm adapter forwards its transform map; source
identity in Farm output depends on the compiler restoring transform-map composition.
