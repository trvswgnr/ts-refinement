# @ts-refinement/runtime

The dependency-free runtime error API for dynamically checked ts-refinement assertions.

```sh
npm install @ts-refinement/runtime
```

A supported unplugin adapter emits imports from this package when it cannot prove an assertion statically. Keep it in regular dependencies if your build externalizes package dependencies. The predicate for that runtime check is compiled into the consumer bundle and executes there; the compile-time analyzer never executes predicate JavaScript.

```ts
import { RefinementError } from "@ts-refinement/runtime";
```

`RefinementError` exposes the original value, predicate label, optional refinement name, and
optional durable site marker used by `ts-refinement verify`.
