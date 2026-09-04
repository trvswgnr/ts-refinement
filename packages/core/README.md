# ts-refinement

The type-level API for JavaScript-predicate refinement types in TypeScript.

```sh
npm install ts-refinement
```

```ts
import type { Refined } from "ts-refinement";

type Positive = Refined<number, "n > 0">;
```

`ts-refinement` is declaration-only: it has no runtime entry point or dependencies. Bare TypeScript carries its brands but cannot prove predicate implication.

Use `tspc` with `@ts-refinement/typescript-plugin` for TypeScript 5.7 through 6.x checking, or `ttsc` with `@ts-refinement/ttsc` for TypeScript 7 and newer. `@ts-refinement/cli` provides publish verification, and a supported `@ts-refinement/unplugin` adapter inserts runtime checks for unknown assertion sites on the legacy compiler path.

See the repository README for setup, behavior, and predicate rules.
