# @ts-refinement/analyzer

The shared parser, resolver, proof engine, and diagnostic API used by the official ts-refinement build and editor integrations.

```sh
npm install @ts-refinement/analyzer typescript
```

Most applications do not need to install this package directly. It is public for authors of additional tooling integrations.

## Predicate entailment

`entails(source, target)` accepts two arrays of normalized predicates, each interpreted as a
conjunction. It returns `true` only when the analyzer proves that every value satisfying `source`
also satisfies every predicate in `target`. A `false` result means "not proven," not that the
target is false.

The decision procedure works only over normalized IR. It does not execute predicate JavaScript.
Unsupported expressions retain exact-key reflexivity but do not produce optimistic proofs.

Subject names and whitespace are normalized for analyzer decisions; bare TypeScript still sees the original predicate strings as distinct brand keys. Primitive literal module constants are folded into normalized IR, while rejected captures report RF1000003.

The compile-time analyzer never executes predicate JavaScript. Build adapters compile predicates needed at runtime into consumer bundle code.

See the repository README for the supported predicate and diagnostic behavior.
