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

See the repository README for editor setup and supported diagnostics.
