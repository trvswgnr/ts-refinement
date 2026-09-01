# @ts-refinement/runtime

The dependency-free runtime error API for dynamically checked ts-refinement assertions.

```sh
npm install @ts-refinement/runtime
```

The Rolldown transform emits imports from this package when it cannot prove an assertion statically. Keep it in regular dependencies if your build externalizes package dependencies.

```ts
import { RefinementError } from "@ts-refinement/runtime";
```
