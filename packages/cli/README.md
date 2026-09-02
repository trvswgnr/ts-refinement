# @ts-refinement/cli

The refinement-aware TypeScript project checker for ts-refinement.

```sh
npm install --save-dev @ts-refinement/cli typescript
npx ts-refinement check
```

Pass `--project` or `-p` a `tsconfig.json` path or a directory containing one. The command reports
ordinary TypeScript diagnostics together with refinement diagnostics and never emits files.

Use this command in CI in place of bare `tsc --noEmit` when refinement implication affects
assignability.
