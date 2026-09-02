# @ts-refinement/rolldown

The compatibility entry point for the Rolldown adapter from `@ts-refinement/unplugin`. It also
works with tsdown and preserves the original default and `refinementTypesPlugin` exports.

```sh
npm install ts-refinement @ts-refinement/runtime
npm install --save-dev @ts-refinement/rolldown typescript tsdown
```

```ts
import { defineConfig } from "tsdown";
import refinementTypes from "@ts-refinement/rolldown";

export default defineConfig({
  entry: ["src/index.ts"],
  plugins: [refinementTypes()],
});
```

New integrations can import `@ts-refinement/unplugin/rolldown` directly. This package depends on
the unified integration and contains only the compatibility re-export.

See the repository README for configuration and runtime behavior.
