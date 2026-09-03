# @ts-refinement/cli

Publish-time verification for transformed ts-refinement output.

```sh
npm install --save-dev @ts-refinement/cli
npx ts-refinement verify dist
```

The command reads `dist/.ts-refinement-manifest.json` by default. Pass `--manifest` to select a
different manifest path. Missing manifests, changed assets, malformed JavaScript, and missing
runtime site markers fail verification. It has no TypeScript compiler dependency and works with
output produced by either the legacy unplugin adapters or the native `ttsc` transform.

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

RF1000500 warns when this contract is missing. It is a warning in the initial release and is planned
to become an error in `0.3`.
