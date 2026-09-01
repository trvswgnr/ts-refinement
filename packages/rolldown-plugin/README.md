# @ts-refinement/rolldown

The official Rolldown-compatible build transform for ts-refinement. It also works with tsdown.

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

`magic-string` is a dependency of this package only. The shared analyzer is bundled into the transform so it does not add another installation-time dependency.

See the repository README for configuration and runtime behavior.
