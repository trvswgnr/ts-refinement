# ts-refinement

The type-level API for JavaScript-predicate refinement types in TypeScript.

```sh
npm install ts-refinement
```

```ts
import type { Refined } from "ts-refinement";

type Positive = Refined<number, "n > 0">;
```

`ts-refinement` has no runtime dependencies. Use the official `@ts-refinement/rolldown` and `@ts-refinement/typescript-plugin` packages to enforce assertions during builds and in the editor.

See the repository README for setup, behavior, and predicate rules.
