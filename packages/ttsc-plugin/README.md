# @ts-refinement/ttsc

Native TypeScript-Go diagnostics and transforms for ts-refinement on TypeScript 7 and newer.

## Installation

```sh
bun add ts-refinement @ts-refinement/runtime
bun add --dev @ts-refinement/ttsc ttsc typescript
```

Register both stages in `tsconfig.json`:

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

Use `ttsc check` for type checking and `ttsc build --emit` for compiler emission. The check stage reports TypeScript and refinement diagnostics, filters assignment errors discharged by predicate entailment, and supplies editor diagnostics through ttsc's LSP bridge. The transform stage erases proven assertions and inserts runtime validation for unknown direct or nested assertions.

TypeScript 5.7 through 6.x projects should use `tspc` with `@ts-refinement/typescript-plugin` instead.
