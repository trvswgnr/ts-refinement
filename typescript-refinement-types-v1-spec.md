# TypeScript Refinement Types — v1 Engineering Specification

**Status:** Ready for implementation  
**Target:** TypeScript + tsdown/Rolldown + TypeScript Language Service  
**Project/package name:** intentionally unresolved; do not block implementation on npm naming

---

## 1. Objective

Build a TypeScript refinement-type system that lets developers attach a JavaScript predicate to an ordinary TypeScript type:

```ts
type Positive = Refined<number, "n > 0">;

type Int = Refined<number, "Number.isInteger(n)">;

type Even = Refined<Int, "n % 2 === 0">;
```

A refinement assertion:

```ts
declare const x: number;

takesEven(x as Even);
```

has stronger semantics than a normal TypeScript `as` assertion when compiled with the refinement tooling.

The toolchain classifies each refinement assertion into one of three states:

| State | Example | Editor | Build output |
| --- | --- | --- | --- |
| Provably valid | `4 as Even` | no error | validation erased |
| Provably invalid | `5 as Even` | diagnostic | build error |
| Not statically knowable | `x as Even` | no error | runtime validation inserted |

The primary developer experience is ordinary TypeScript syntax plus a single type constructor:

```ts
Refined<Base, "javascript expression">
```

There is no separate schema language and no v1 refinement-specific predicate vocabulary.

---

## 2. Core design decisions

These decisions are part of the v1 contract.

### 2.1 Refinement predicates are JavaScript

The second generic argument is a string literal containing a JavaScript expression.

```ts
type Positive =
  Refined<number, "n > 0">;

type FinitePositive =
  Refined<number, "Number.isFinite(n) && n > 0">;

type NonEmptyString =
  Refined<string, "s.length > 0">;

type NonEmptyArray<T> =
  Refined<T[], "xs.length > 0">;

type AllPositive =
  Refined<number[], "xs.every(x => x > 0)">;

type Slug =
  Refined<string, "/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)">;
```

The language does **not** introduce aliases such as:

```ts
// Not v1
Refined<number, "int">
Refined<string, "nonempty">
```

If integer semantics are wanted, write JavaScript:

```ts
type Int = Refined<number, "Number.isInteger(n)">;
```

The same rule applies to operators. JavaScript operators retain normal JavaScript meaning.

```ts
// Correct
type Even = Refined<number, "Number.isInteger(n) && n % 2 === 0">;
```

There is no refinement-specific interpretation of `|`, `=`, `and`, `or`, etc.

### 2.2 The subject identifier is inferred

The refined value does not have a fixed magic identifier such as `$` or `value`.

All of these are equivalent:

```ts
type A = Refined<number, "n > 0">;
type B = Refined<number, "x > 0">;
type C = Refined<number, "value > 0">;
type D = Refined<number, "potato > 0">;
```

The compiler parses the expression and performs lexical free-variable analysis.

Given:

```ts
type AllPositive =
  Refined<number[], "xs.every(x => x > 0)">;
```

the analysis is:

```text
xs  -> free identifier -> refinement subject
x   -> locally bound by arrow function
```

Given:

```ts
type Even =
  Refined<number, "Number.isInteger(n) && n % 2 === 0">;
```

the analysis is:

```text
Number -> standard JavaScript global
n      -> free identifier -> refinement subject
```

The spelling of the subject is erased during normalization. These predicates therefore normalize identically:

```ts
"x > 0"
"n > 0"
"value > 0"
```

Internal normalized form:

```text
SUBJECT > 0
```

This enables validator deduplication independent of identifier naming.

### 2.3 No external lexical captures in v1

A refinement may use:

- its inferred subject
- literals
- JavaScript operators
- standard ECMAScript globals
- properties and methods reachable from the subject or standard globals
- identifiers locally bound inside nested function expressions

It may not reference arbitrary variables from the surrounding TypeScript module.

Reject:

```ts
const MIN = 10;

type AtLeastMin =
  Refined<number, "n >= MIN">;
```

The reason is architectural, not syntactic. A refinement can be declared in one module and consumed through a type-only import in another:

```ts
// limits.ts
const MIN = 10;

export type AtLeastMin =
  Refined<number, "n >= MIN">;
```

```ts
// consumer.ts
import type { AtLeastMin } from "./limits";

declare const n: number;

const value = n as AtLeastMin;
```

Generating runtime validation in `consumer.ts` would require turning a type-only dependency into a runtime dependency and preserving the captured value's semantics.

That is deliberately out of scope for v1.

Example diagnostic:

```text
RF1002: Refinement expression contains multiple unresolved identifiers.

  n
  MIN

Refinement predicates may only reference the refined value,
standard JavaScript globals, and locally-bound identifiers.
```

### 2.4 Composition uses TypeScript types

Refine an already-refined type rather than inventing refinement combinators.

```ts
type Int =
  Refined<number, "Number.isInteger(n)">;

type Even =
  Refined<Int, "n % 2 === 0">;

type PositiveEven =
  Refined<Even, "n > 0">;
```

Semantically:

```text
PositiveEven
  base: number
  predicates:
    Number.isInteger(SUBJECT)
    SUBJECT % 2 === 0
    SUBJECT > 0
```

This preserves a useful TypeScript subtype chain:

```text
PositiveEven <: Even <: Int <: number
```

Example:

```ts
declare const value: PositiveEven;

const a: Even = value;
const b: Int = value;
const c: number = value;
```

No custom implication solver is required for these assignments; the relationship is encoded by the TypeScript type structure itself.

A developer may still write a self-contained refinement:

```ts
type EvenNumber =
  Refined<
    number,
    "Number.isInteger(n) && n % 2 === 0"
  >;
```

However, TypeScript will not infer that `EvenNumber` is assignable to a separately-declared `Int`, because TypeScript does not prove logical implication between predicate strings.

The canonical style for semantic subtype relationships is therefore nested `Refined`.

---

## 3. Public type API

The minimum public API is one type:

```ts
export type Refined<Base, Predicate extends string> = /* brand */;
```

Recommended implementation:

```ts
declare const refinementBrand: unique symbol;

type RefinementTags<Expr extends string> = {
  readonly [K in Expr]: true;
};

export type Refined<Base, Predicate extends string> =
  Base & {
    readonly [refinementBrand]: RefinementTags<Predicate>;
  };
```

For nested refinements:

```ts
type Int =
  Refined<number, "Number.isInteger(n)">;

type Even =
  Refined<Int, "n % 2 === 0">;
```

the resulting intersection accumulates refinement tags while remaining a subtype of the base type.

The brand is type-only. No branded property is added to runtime values.

### Requirements for the brand implementation

1. `Refined<T, P>` must be assignable to `T`.
2. `T` must not be assignable to `Refined<T, P>` without an assertion/narrowing operation.
3. `Refined<Refined<T, P1>, P2>` must remain assignable to `Refined<T, P1>`.
4. The compiler must be able to reliably identify marker members and recover concrete predicate string literals.
5. The brand symbol should not pollute normal user IntelliSense.

Add explicit compiler tests for these properties before building the transform.

---

## 4. Refinement assertion semantics

The v1 refinement boundary is a TypeScript assertion whose target contains one or more refinement markers.

```ts
expression as RefinedType
```

Example:

```ts
type Positive = Refined<number, "n > 0">;

declare const x: number;

const y = x as Positive;
```

The plugin interprets this as:

> Establish that `x` satisfies all predicates required by `Positive`.

It is not treated as an unchecked cast.

---

## 5. Source/base type rule

V1 is a **refinement validator**, not a general runtime TypeScript type reifier.

The source expression must already be statically assignable to the unrefined base type.

Valid:

```ts
declare const n: number;

const x = n as Positive;
```

Invalid:

```ts
declare const x: unknown;

const n = x as Positive;
```

Diagnostic:

```text
RF1101: Cannot refine 'unknown' as 'Positive'.

The source must already be assignable to the refinement base type 'number'.
```

Likewise, direct refinement from `any` should be rejected by default.

```ts
declare const x: any;

// diagnostic
const n = x as Positive;
```

This avoids silently turning v1 into a runtime validator for arbitrary TypeScript structural types.

The toolchain is not intended to repair the general unsoundness of TypeScript assertions. A user can still lie to TypeScript through unrelated casts:

```ts
const n = external as unknown as number;
const p = n as Positive;
```

The refinement tooling guarantees only that the refinement predicate is established at the refinement boundary. It does not prove the truth of previous ordinary TypeScript assertions.

---

## 6. Predicate parsing

Do not use `eval`, `Function`, `vm`, or any equivalent mechanism while analyzing source.

The compiler must parse the predicate into an AST.

The simplest v1 implementation is to reuse TypeScript's parser so the project does not require another JavaScript parser dependency.

Conceptually:

```ts
function parsePredicate(
  ts: typeof import("typescript"),
  source: string,
): ts.Expression {
  const file = ts.createSourceFile(
    "__refinement__.js",
    `const __predicate = (${source});`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );

  // validate parse diagnostics
  // locate initializer
  // return expression AST
}
```

Important: the language-service plugin must use the `typescript` instance supplied by `tsserver`, not an independently-imported TypeScript instance.

The shared analyzer should therefore accept the TypeScript module as a dependency:

```ts
export interface AnalyzerContext {
  ts: typeof import("typescript");
  checker: ts.TypeChecker;
  program: ts.Program;
}
```

---

## 7. Predicate syntax policy

The predicate must parse as a JavaScript expression.

Valid examples:

```ts
"n > 0"
"Number.isInteger(n)"
"Number.isFinite(n) && n >= 0"
"Math.abs(n) < 10"
"s.length > 0"
"s.startsWith('foo')"
"/^[a-z]+$/.test(s)"
"xs.length >= 1"
"xs.every(x => Number.isFinite(x))"
"xs.every((x, i) => i === 0 || xs[i - 1] <= x)"
```

A refinement expression is evaluated in JavaScript boolean context: a truthy result passes and a falsy result fails.

For v1, reject constructs that clearly do not make sense as a predicate expression or introduce control-flow/runtime environment complexity:

- assignments
- update expressions (`++`, `--`)
- `await`
- `yield`
- statement syntax
- dynamic import
- external free-variable capture

Do **not** invent alternate semantics for otherwise-valid JavaScript constructs.

A separate purity policy may be tightened later. V1 should prioritize normal JavaScript semantics and deterministic compiler behavior over designing a second language.

Crucially, arbitrary user JavaScript is **never executed by the compiler or editor plugin**. Unknown or unsupported static operations simply produce an `unknown` proof result and are left for runtime validation.

---

## 8. Subject inference

Implement lexical scope analysis over the parsed predicate AST.

### 8.1 Candidate collection

Collect identifier references that are not:

- property names in non-computed member expressions
- object literal keys where the identifier is not a value reference
- labels
- locally-bound function parameters
- locally-bound variables
- known standard ECMAScript globals

Example:

```js
xs.every(x => x > 0)
```

Candidates:

```text
xs
```

Not candidates:

```text
every  // property name
x      // arrow parameter
```

### 8.2 Standard globals

V1 should recognize standard ECMAScript globals such as:

```text
Array
BigInt
Boolean
Date
Error
Infinity
JSON
Map
Math
NaN
Number
Object
Promise
RegExp
Set
String
Symbol
WeakMap
WeakSet
parseFloat
parseInt
isFinite
isNaN
undefined
```

Keep this list scoped to ECMAScript rather than environment-specific globals.

Do not initially treat Node or DOM globals as implicitly available:

```text
Buffer
process
window
document
fetch
```

Environment-specific globals can become a configurable feature later.

### 8.3 Inference outcomes

Exactly one unresolved free identifier:

```ts
Refined<number, "Number.isInteger(n) && n > 0">
```

Result:

```text
subject = n
```

No unresolved free identifiers:

```ts
Refined<number, "true">
```

Treat as a subjectless predicate. It is legal, although rarely useful.

More than one unresolved free identifier:

```ts
Refined<number, "n > min">
```

Result:

```text
diagnostic RF1002
```

Do not guess.

---

## 9. Normalized predicate IR

The parser output should not be used directly as the shared semantic representation.

Create a normalized internal IR that:

- replaces the inferred subject identifier with a dedicated `Subject` node
- preserves standard-global references
- tracks lexical binding inside nested functions
- normalizes syntactic trivia
- can be serialized deterministically
- can be hashed for validator deduplication
- can be evaluated without executing JavaScript

Example input:

```js
Number.isInteger(n) && n % 2 === 0
```

Normalized form:

```text
LogicalAnd
├── Call
│   ├── Member
│   │   ├── Global("Number")
│   │   └── "isInteger"
│   └── Subject
└── StrictEqual
    ├── Modulo
    │   ├── Subject
    │   └── NumberLiteral(2)
    └── NumberLiteral(0)
```

Do not attempt a full ESTree clone. The IR only needs nodes required by currently-supported JavaScript expressions and can retain an opaque fallback node for constructs the static evaluator does not understand.

The runtime emitter may emit from the original parsed AST after safe subject substitution, while the normalized IR is used for identity and proof.

---

## 10. Resolving refinement types

Given an `as` expression:

```ts
x as Even
```

use the real TypeScript `TypeChecker` to resolve the target type.

The analyzer must:

1. resolve aliases;
2. flatten intersections;
3. identify the refinement brand marker(s);
4. recover every concrete predicate string;
5. recover the non-marker base type;
6. preserve refinement order where possible for diagnostics;
7. reject non-concrete/generic predicate strings that cannot be materialized at the assertion site.

Example:

```ts
type Int =
  Refined<number, "Number.isInteger(n)">;

type Even =
  Refined<Int, "n % 2 === 0">;
```

Resolved target:

```text
base:
  number

predicates:
  Number.isInteger(n)
  n % 2 === 0
```

The exact internal representation of the brand is allowed to change if TypeScript's type normalization makes the proposed mapped-type brand difficult to recover. The public behavior and subtype requirements are the contract.

Build this resolver as an isolated module with fixture tests against multiple TypeScript versions.

---

## 11. Static proof model

Static validation is deliberately conservative.

Every predicate proof returns:

```ts
type Proof =
  | { kind: "true" }
  | { kind: "false"; reason?: string }
  | { kind: "unknown" };
```

The evaluator must never execute arbitrary JavaScript.

### 11.1 Initial proof inputs

MVP proof should support:

- primitive literals
- parenthesized primitive literals
- unary expressions over literals where trivial
- concrete literal types supplied by the TypeChecker

Examples:

```ts
4 as Even
// true

5 as Even
// false

-5 as Positive
// false

declare const x: number;
x as Positive
// unknown
```

### 11.2 Initial evaluator operations

Implement enough evaluation for the first vertical slice:

- number/string/boolean/null literals
- unary `!`, `+`, `-`
- arithmetic `+`, `-`, `*`, `/`, `%`, `**`
- comparisons
- strict equality/inequality
- `&&`, `||`, `??`
- conditional expression
- property access on statically-known primitive values
- a small set of statically-modeled ECMAScript operations required by tests, beginning with:
  - `Number.isInteger`
  - `Number.isFinite`

This static evaluator support is **not** a user-visible refinement DSL.

For example, `Number.isInteger` is not a "refinement built-in." It is ordinary JavaScript that the static evaluator happens to know how to prove.

If the evaluator encounters a valid JavaScript operation it does not model:

```ts
type Foo = Refined<string, "s.normalize() === s">;
```

the refinement remains valid. Static proof returns `unknown`; runtime validation handles it.

This distinction is fundamental.

---

## 12. Classification behavior

For a target with predicates `P1..Pn`, prove the conjunction.

### Provably valid

```ts
type Positive = Refined<number, "n > 0">;

const x = 4 as Positive;
```

Result:

```text
true
```

Build transform:

```ts
const x = 4;
```

### Provably invalid

```ts
const x = -4 as Positive;
```

Result:

```text
false
```

Editor diagnostic and build error:

```text
RF1200: Value does not satisfy refinement 'Positive'.

Predicate:
  n > 0

Value:
  -4
```

### Unknown

```ts
declare const n: number;

const x = n as Positive;
```

Result:

```text
unknown
```

Build transform inserts a runtime assertion.

---

## 13. Runtime validation

Unknown assertions must validate the value exactly once and return the original value.

Conceptual output:

```js
const x = __rf_positive(n);
```

Generated validator:

```js
function __rf_positive(value) {
  if (!(value > 0)) {
    throw new RefinementError("Positive", "n > 0", value);
  }

  return value;
}
```

Nested refinements should generate one validator containing the conjunction:

```ts
type Int =
  Refined<number, "Number.isInteger(n)">;

type Even =
  Refined<Int, "n % 2 === 0">;
```

Possible output:

```js
function __rf_even(value) {
  if (!(
    Number.isInteger(value) &&
    value % 2 === 0
  )) {
    throw new RefinementError(/* ... */);
  }

  return value;
}
```

The original source expression must never be duplicated:

```ts
getValue() as Even
```

must become equivalent to:

```js
__rf_even(getValue())
```

not:

```js
Number.isInteger(getValue()) &&
getValue() % 2 === 0
```

---

## 14. Runtime error API

Ship a small runtime error type.

```ts
export class RefinementError extends TypeError {
  readonly refinement?: string;
  readonly predicate: string;
  readonly value: unknown;

  constructor(options: {
    refinement?: string;
    predicate: string;
    value: unknown;
  }) {
    // ...
  }
}
```

Do not serialize arbitrary object values into the default error message. Preserve the actual value on the error object for debugging.

Suggested message:

```text
Value failed refinement 'Even': Number.isInteger(n) && n % 2 === 0
```

Production minification/error-message policy can be added later.

---

## 15. Validator deduplication

Validators should be deduplicated by normalized semantics, not by type alias name or subject identifier spelling.

These should share one validator:

```ts
type A = Refined<number, "n > 0">;
type B = Refined<number, "value > 0">;
```

Normalization:

```text
SUBJECT > 0
```

Hash input should include:

- normalized predicate IR
- normalized inherited predicates
- any runtime semantics options that affect generated behavior

Alias name should not participate in semantic identity, although it may participate in development error labels.

---

## 16. Build plugin

Target tsdown first, implemented as a Rolldown-compatible plugin.

tsdown supports Rolldown plugins and exposes module transform hooks, so no fork of tsdown is required.

Suggested package/module:

```text
packages/
  core/
  analyzer/
  runtime/
  rolldown-plugin/
  typescript-plugin/
```

Actual npm names are intentionally deferred until project naming is resolved.

### 16.1 Build lifecycle

At build start:

1. locate the project's `tsconfig.json`;
2. create a TypeScript `Program`;
3. create a `TypeChecker`;
4. initialize the shared refinement analyzer;
5. prepare a per-build validator registry.

For each TypeScript module:

1. obtain the matching `SourceFile`;
2. visit `AsExpression` nodes;
3. resolve the target type;
4. skip targets with no refinement markers;
5. verify source assignability to the base type;
6. parse/normalize all predicates;
7. statically classify the assertion;
8. erase, error, or replace as appropriate;
9. inject required validator helpers/imports;
10. return transformed code and source map.

Use source-position-preserving edits (for example, `magic-string`) rather than printing the entire TypeScript AST unless there is a compelling reason otherwise.

This minimizes formatting churn and preserves interoperability with downstream transforms.

### 16.2 Build errors

Provably-invalid refinement assertions are build errors, not warnings.

Malformed predicates and invalid subject inference are also build errors.

The plugin should use Rolldown's normal error mechanism so diagnostics contain file, line, and column.

---

## 17. TypeScript Language Service plugin

The editor integration is a TypeScript Language Service plugin.

TypeScript language-service plugins can add diagnostics in editors such as VS Code, but they do not run during normal `tsc` command-line compilation and cannot change TypeScript's core type system.

The plugin therefore shares analysis with the build plugin but has a different integration surface.

Configuration:

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "<package-name>"
      }
    ]
  }
}
```

For VS Code development/testing, ensure the workspace TypeScript version is used when necessary so the editor can resolve the plugin.

### 17.1 Initial integration

Proxy the existing language service and augment:

```ts
getSemanticDiagnostics(fileName)
```

Conceptually:

```ts
proxy.getSemanticDiagnostics = fileName => {
  const existing =
    info.languageService.getSemanticDiagnostics(fileName);

  const refinementDiagnostics =
    analyzeFileForDiagnostics(fileName);

  return [
    ...existing,
    ...refinementDiagnostics,
  ];
};
```

Do not duplicate analysis logic in the editor plugin.

The shared analyzer must return editor-neutral diagnostics:

```ts
interface RefinementDiagnostic {
  code: number;
  message: string;
  start: number;
  length: number;
  severity: "error" | "warning";
}
```

The TS plugin converts those to `ts.Diagnostic`.

---

## 18. Editor diagnostics

V1 should surface at least these cases.

### Malformed JavaScript predicate

```ts
type Positive =
  Refined<number, "n >>>">;
```

Diagnostic should point into or as close as practical to the string literal:

```text
RF1000: Invalid refinement JavaScript expression.
```

### Ambiguous free identifiers

```ts
type Foo =
  Refined<number, "n > min">;
```

```text
RF1002: Cannot infer refinement subject.
Unresolved identifiers: n, min
```

### Source/base mismatch

```ts
declare const x: unknown;

const y = x as Positive;
```

```text
RF1101: Source type 'unknown' is not assignable to refinement base type 'number'.
```

### Provably false assertion

```ts
const y = -1 as Positive;
```

```text
RF1200: Value '-1' does not satisfy refinement 'Positive'.
Predicate: n > 0
```

### Unknown assertion

```ts
declare const n: number;

const y = n as Positive;
```

No editor error. Runtime validation is expected.

---

## 19. Diagnostic code allocation

Reserve a range.

```text
RF1000-RF1099  Predicate parsing / normalization
RF1100-RF1199  Type/base compatibility
RF1200-RF1299  Static proof failures
RF1300-RF1399  Transform/codegen
RF1400-RF1499  Unsupported generic/reflection cases
```

Initial codes:

```text
RF1000  Invalid JavaScript expression
RF1001  Predicate string must be a concrete string literal
RF1002  Cannot infer refinement subject
RF1003  Disallowed external capture
RF1101  Source not assignable to base type
RF1200  Refinement statically disproven
RF1400  Unable to resolve refinement metadata
```

Keep messages identical between editor and build where possible.

---

## 20. Suggested repository layout

```text
repo/
├── packages/
│   ├── core/
│   │   └── src/
│   │       └── index.ts
│   │
│   ├── analyzer/
│   │   └── src/
│   │       ├── index.ts
│   │       ├── predicate/
│   │       │   ├── parse.ts
│   │       │   ├── scope.ts
│   │       │   ├── normalize.ts
│   │       │   ├── ir.ts
│   │       │   └── globals.ts
│   │       ├── refinement/
│   │       │   ├── resolve.ts
│   │       │   ├── base-type.ts
│   │       │   └── compose.ts
│   │       ├── proof/
│   │       │   ├── evaluate.ts
│   │       │   ├── values.ts
│   │       │   └── ecmascript.ts
│   │       └── diagnostics.ts
│   │
│   ├── runtime/
│   │   └── src/
│   │       ├── assert.ts
│   │       └── error.ts
│   │
│   ├── rolldown-plugin/
│   │   └── src/
│   │       ├── index.ts
│   │       ├── program.ts
│   │       ├── transform.ts
│   │       ├── validators.ts
│   │       └── source-map.ts
│   │
│   └── typescript-plugin/
│       └── src/
│           ├── index.ts
│           └── diagnostics.ts
│
├── fixtures/
│   ├── basic/
│   ├── composition/
│   ├── cross-module/
│   ├── diagnostics/
│   └── runtime/
│
├── tests/
│   ├── type-brand.test.ts
│   ├── predicate-parser.test.ts
│   ├── subject-inference.test.ts
│   ├── resolver.test.ts
│   ├── proof.test.ts
│   ├── transform.test.ts
│   └── language-service.test.ts
│
└── examples/
    └── tsdown/
```

A monorepo is recommended because the language-service plugin and build plugin must consume exactly the same analyzer implementation.

---

## 21. Shared analyzer API

Aim for a small stable core.

```ts
export interface RefinementDefinition {
  baseType: ts.Type;
  predicates: NormalizedPredicate[];
  displayName?: string;
}

export interface RefinementSite {
  fileName: string;
  node: ts.AsExpression;
  sourceType: ts.Type;
  targetType: ts.Type;
  definition: RefinementDefinition;
}

export interface AnalysisResult {
  site: RefinementSite;
  proof: Proof;
  diagnostics: RefinementDiagnostic[];
}

export function resolveRefinement(
  context: AnalyzerContext,
  targetType: ts.Type,
): RefinementDefinition | null;

export function analyzeAssertion(
  context: AnalyzerContext,
  node: ts.AsExpression,
): AnalysisResult | null;
```

The build plugin and TS plugin should not directly inspect brand internals.

---

## 22. First vertical slice

Do not start by implementing the entire JavaScript static evaluator.

Implement one end-to-end case first.

### Required input

```ts
import type { Refined } from "<core>";

type Positive =
  Refined<number, "n > 0">;

declare const dynamic: number;

const a = 5 as Positive;
const b = -5 as Positive;
const c = dynamic as Positive;
```

### Required behavior

Editor:

```text
a -> no diagnostic
b -> RF1200 diagnostic
c -> no diagnostic
```

Build:

```text
a -> assertion erased
b -> build fails
c -> runtime assertion generated
```

This proves all critical integration points:

- brand detection
- predicate string extraction
- JS parsing
- subject inference
- normalized IR
- static proof
- editor diagnostics
- tsdown/Rolldown transform
- runtime helper generation

Only after this works should `Number.isInteger` and nested refinements be added.

---

## 23. Implementation order

### Phase 1 — Type marker

Implement and test:

```ts
Refined<Base, Predicate>
```

Acceptance tests:

```ts
declare const n: number;
declare const i: Int;
declare const e: Even;

// @ts-expect-error
const a: Int = n;

const b: number = i;
const c: Int = e;
```

### Phase 2 — Predicate parser and subject inference

Support:

```ts
"n > 0"
"value > 0"
"xs.every(x => x > 0)"
```

Produce deterministic normalized IR.

No TypeScript integration yet.

### Phase 3 — Refinement resolver

Given a TypeScript `Type`, recover:

```text
base
predicates[]
```

Support aliases and nested `Refined`.

### Phase 4 — Static evaluator

Implement literals and basic operators.

Demonstrate:

```ts
5 as Positive   // true
-5 as Positive  // false
x as Positive   // unknown
```

### Phase 5 — Build transform

Implement Rolldown plugin.

Generate runtime validation for unknown assertions.

### Phase 6 — Language-service diagnostics

Reuse the analyzer and proof engine.

Surface RF1000/RF1002/RF1101/RF1200 in VS Code.

### Phase 7 — Integer/even composition

Add static modeling for ordinary JS:

```ts
Number.isInteger(n)
```

Verify:

```ts
type Int =
  Refined<number, "Number.isInteger(n)">;

type Even =
  Refined<Int, "n % 2 === 0">;

4 as Even // true
5 as Even // false
x as Even // runtime
```

### Phase 8 — Hardening

- cross-file aliases
- type-only imports
- validator deduplication
- source maps
- watch mode
- generic failure diagnostics
- TypeScript-version compatibility matrix

---

## 24. Test matrix

Every feature should be tested in three layers where applicable:

```text
analyzer
build plugin
language-service plugin
```

### Predicate parsing

```ts
Refined<number, "n > 0">
Refined<number, "(n > 0)">
Refined<number, "Number.isInteger(n)">
Refined<string, "/x/.test(s)">
Refined<number[], "xs.every(x => x > 0)">
```

Malformed:

```ts
Refined<number, "n >">
Refined<number, "if (n) true">
```

### Subject inference

```ts
"n > 0"                         -> n
"value > 0"                     -> value
"Number.isInteger(n)"           -> n
"xs.every(x => x > 0)"          -> xs
"xs.map(x => x + 1).length > 0" -> xs
"true"                          -> none
"n > min"                       -> error
```

### Composition

```ts
type Int =
  Refined<number, "Number.isInteger(n)">;

type Even =
  Refined<Int, "n % 2 === 0">;

type PositiveEven =
  Refined<Even, "n > 0">;
```

Verify inherited predicates are all resolved.

### Static proof

```ts
5 as Positive
-5 as Positive
0 as Positive
4 as Even
5 as Even
```

### Unknown values

```ts
declare const n: number;

n as Positive
n as Int
n as Even
```

Verify runtime validation.

### Evaluation count

```ts
getNumber() as Positive
```

Verify `getNumber()` executes exactly once.

### Base mismatch

```ts
declare const x: unknown;
declare const y: any;
declare const s: string;

x as Positive
y as Positive
s as Positive
```

All should produce a refinement diagnostic rather than silently generating a predicate-only check.

### Cross-module

```ts
// types.ts
export type Positive =
  Refined<number, "n > 0">;
```

```ts
// consumer.ts
import type { Positive } from "./types";

declare const n: number;

n as Positive;
```

Must resolve and transform correctly.

---

## 25. Performance requirements

Editor latency matters more than build throughput.

The analyzer must cache:

- parsed predicate strings
- normalized predicate IR
- resolved refinement metadata by `ts.Type`/symbol where safe
- proof results for stable literal sites

Do not reconstruct a TypeScript `Program` inside individual language-service diagnostic calls.

Use the language service's existing program:

```ts
info.languageService.getProgram()
```

For builds, create one program per build graph and reuse its checker across transforms.

The predicate parser cache key can simply be the exact predicate source string.

The normalized validator cache key should be the normalized predicate sequence.

---

## 26. Watch mode

Watch mode is required before calling v1 production-ready.

The build plugin must invalidate analysis when:

- a source file changes
- an imported type definition changes
- `tsconfig.json` changes
- compiler options affecting module/type resolution change

Initial implementation may recreate the TypeScript `Program` on each rebuild if incremental invalidation is too complex. Correctness is more important than optimization for the first version.

---

## 27. Source maps

Runtime assertion insertion must preserve useful stack traces and build diagnostics.

Use a source-editing library capable of high-resolution source maps.

For:

```ts
const x = getValue() as Positive;
```

a thrown `RefinementError` should map back to the assertion site rather than an unrelated generated helper location where practical.

Build-time diagnostics must point to the original `as` expression.

Predicate-parse diagnostics should point into the predicate string if accurate offset mapping is available; otherwise point to the string literal as a whole.

---

## 28. TypeScript compatibility

Treat `typescript` as a peer dependency for user-facing packages.

The language-service plugin must use the TypeScript module passed by tsserver:

```ts
function init(modules: {
  typescript: typeof import("typescript");
}) {
  const ts = modules.typescript;
}
```

Do not use AST node instances created by one TypeScript module with APIs from a different TypeScript module.

Run CI against a small supported TypeScript version matrix.

Do not promise compatibility with arbitrary historical TypeScript versions in v1.

---

## 29. Platform constraints

### TypeScript editor integration

TypeScript language-service plugins can augment the editor experience and add their own diagnostics.

They cannot:

- change TypeScript syntax
- modify TypeScript's core type system
- affect normal `tsc` command-line checking/emission

Therefore the editor and build integrations are separate adapters around the same analyzer.

Official reference:

https://www.typescriptlang.org/tsconfig/plugins.html

https://github.com/microsoft/TypeScript/wiki/Writing-a-Language-Service-Plugin

### tsdown integration

tsdown uses Rolldown and supports Rolldown plugins, including transform hooks.

Official reference:

https://tsdown.dev/advanced/plugins

This makes a Rolldown-compatible transform the initial build integration.

---

## 30. Explicit v1 non-goals

Do not implement these during the first version.

### No refinement-specific built-ins

No:

```ts
Refined<number, "int">
Refined<string, "nonempty">
```

Use JavaScript.

### No custom refinement operators

No alternate meaning for:

```text
|
=
and
or
```

Use JavaScript operators.

### No external closure capture

No:

```ts
const MIN = 10;
type T = Refined<number, "n >= MIN">;
```

### No full runtime TypeScript validation

Do not recursively generate validators for arbitrary:

```ts
unknown as User
```

The source must already satisfy the base TypeScript type.

### No flow-sensitive refinement inference

Do not initially make this work:

```ts
declare const n: number;

if (n > 0) {
  takesPositive(n);
}
```

TypeScript still sees `n` as `number`, not `Positive`.

A future control-flow analyzer could add diagnostics or helpers, but this is not v1.

### No theorem prover

Do not attempt general implication:

```ts
Refined<number, "n > 10">
```

being automatically recognized by TypeScript as a subtype of:

```ts
Refined<number, "n > 0">
```

Use nested refinement types when the subtype relationship matters.

### No compiler-time JavaScript execution

Never evaluate user predicate strings with:

```text
eval
Function
vm
child process
```

The static evaluator interprets known AST operations only.

### No requirement to support plain `tsc` transforms

Editor diagnostics come from the TS language-service plugin.

Runtime code generation comes from the build plugin.

---

## 31. Future directions

These are intentionally deferred but the architecture should not preclude them.

### Additional build adapters

The shared transform could later be exposed through:

- unplugin
- Vite
- Rollup
- esbuild
- SWC-based toolchains

### Explicit subject syntax

If real-world code demonstrates a need for external captures or inference disambiguation, an explicit form could be designed later.

Do not add one preemptively.

### Environment globals

Allow project configuration such as:

```json
{
  "refinements": {
    "globals": ["URL"]
  }
}
```

only if needed.

### Rich predicate editor tooling

Potential TypeScript LS features:

- syntax diagnostics inside predicate strings
- semantic checks against the base type
- completions for subject properties
- hover information
- subject rename support

These are valuable but not necessary to prove the core system.

### Refinement-aware helper functions

Potential future API:

```ts
is<Positive>(value)
assert<Positive>(value)
parse<Positive>(value)
```

These require compiler-recognized intrinsics and are not needed for the initial `as`-based model.

### Stronger static proof

Future evaluator improvements could prove:

```ts
const n = 2 + 2 as Even;
```

or reason over literal unions and selected local constant propagation.

Keep the proof engine conservative: inability to prove must always degrade to runtime validation, not unsound acceptance.

---

## 32. Definition of done for v1

V1 is complete when this program works end-to-end:

```ts
import type { Refined } from "<package>";

type Positive =
  Refined<number, "n > 0">;

type Int =
  Refined<number, "Number.isInteger(n)">;

type Even =
  Refined<Int, "n % 2 === 0">;

declare const dynamic: number;

function takesEven(n: Even) {
  return n;
}

takesEven(4 as Even);       // accepted, runtime check erased
takesEven(5 as Even);       // editor error + build error
takesEven(dynamic as Even); // accepted, runtime validation emitted
```

And the following engineering criteria are met:

- the same analyzer powers editor and build behavior;
- malformed predicate strings produce diagnostics;
- subject identifiers are inferred rather than reserved;
- nested refinements compose correctly;
- source expressions are evaluated exactly once;
- refinement validators are deduplicated;
- cross-module type aliases work;
- type-only imports remain type-only;
- the compiler never executes arbitrary predicate JavaScript;
- build output has working source maps;
- watch mode is correct;
- representative tests pass against all supported TypeScript versions.

---

## 33. First implementation ticket

**Title:** Implement end-to-end `Refined<number, "n > 0">`

### Deliverables

1. Implement the branded `Refined` type.
2. Parse the predicate string as JavaScript.
3. Infer `n` as the subject.
4. Resolve `Positive` from an `as Positive` assertion.
5. Statically classify numeric literals.
6. Build a Rolldown plugin that:
   - erases `5 as Positive`;
   - errors on `-5 as Positive`;
   - inserts validation for `numberExpression as Positive`.
7. Build a TypeScript language-service plugin that reports the same invalid-literal diagnostic.
8. Add integration fixtures for tsdown and VS Code/tsserver behavior.

### Acceptance fixture

```ts
type Positive =
  Refined<number, "n > 0">;

declare const n: number;

export const knownGood = 5 as Positive;
export const knownBad = -5 as Positive;
export const runtime = n as Positive;
```

Expected:

```text
knownGood:
  no editor diagnostic
  no runtime assertion

knownBad:
  RF1200 editor diagnostic
  build fails

runtime:
  no editor diagnostic
  runtime assertion emitted
```

Do not expand scope until this fixture passes end-to-end.
