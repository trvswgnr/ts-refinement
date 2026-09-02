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

Use `@ts-refinement/typescript-plugin` for editor diagnostics, `@ts-refinement/cli` for CI checking and publish verification, and a supported `@ts-refinement/unplugin` adapter to insert runtime checks for unknown assertion sites.

See the repository README for setup, behavior, and predicate rules.
