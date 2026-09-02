# @ts-refinement/typescript-plugin

The official TypeScript language-service plugin for ts-refinement diagnostics.

```sh
npm install ts-refinement
npm install --save-dev @ts-refinement/typescript-plugin typescript
```

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "@ts-refinement/typescript-plugin"
      }
    ]
  }
}
```

The shared analyzer is bundled into this CommonJS package so tsserver can load it without crossing an ESM/CommonJS package boundary.

This package provides editor diagnostics only. Use `ts-refinement check` in CI, a supported
unplugin adapter for runtime transforms, and `ts-refinement verify` from `prepack`. RF1500 is
reported as a warning when a publishable package exposes refinements without configured
verification.

See the repository README for editor setup and supported diagnostics.
