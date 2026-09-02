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

Bare TypeScript still carries branded types, but it cannot delegate predicate implication to the
analyzer. The checker does not transform code or insert runtime validators.

Verify that a final package build retains every runtime-required assertion:

```sh
npx ts-refinement verify dist
```

The command reads `dist/.ts-refinement-manifest.json` by default. Pass `--manifest` to select a
different manifest path. Missing manifests, changed assets, malformed JavaScript, and missing
runtime site markers fail verification.

Publishable packages exposing refinements should configure the output directory and call the
verifier directly from `prepack`:

```json
{
  "scripts": {
    "prepack": "bun run build && ts-refinement verify dist"
  },
  "ts-refinement": {
    "verify": {
      "outDir": "dist"
    }
  }
}
```

RF90500 warns when this contract is missing. It is a warning in the initial release and is planned
to become an error in `0.3`.
