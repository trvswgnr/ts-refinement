# VSCode Quickstart Guide

This will guide you through setting up and using the `ts-refinement` library in VSCode, which involves installing the required packages, configuring your project, and writing code with refinement types.

This guide assumes the following:

- [Bun](https://bun.sh/) >=1.4.0 as your JavaScript runtime and package manager
- [tsdown](https://tsdown.dev) >=0.22.14 as your bundler
- [TypeScript](https://www.typescriptlang.org/) version >=5.7 <7
- A basic understanding of TypeScript and refinement types

1. Install the required packages using Bun:
    ```bash
    bun i ts-refinement @ts-refinement/runtime
    bun i -D @ts-refinement/typescript-plugin @ts-refinement/rolldown
    ```
1. Configure your project to use the TypeScript plugin. Add the following to your `tsconfig.json`:
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
1. Configure the build plugin for **tsdown**:
    ```ts
    export default defineConfig({
        // ...
        plugins: [refinementTypes()],
    });
    ```
1. Run `TypeScript: Select TypeScript Version` from the VSCode command palette and select `Use Workspace Version`. You may have to `Restart TS Server` for the changes to take effect.
1. Write some code with refinement types!
    ```ts
    import type { Refined } from "ts-refinement";

    type Int = Refined<number, "Number.isInteger(n)">;
    type Even = Refined<Int, "n % 2 === 0">;

    const valid = 4 as Even; // no errors as expected
    const invalid = 5 as Even; // error in editor and at build time

    const x = Infinity ? 4 : 5;
    takesEven(
        x as Even, // validated at runtime
    ),
    ```