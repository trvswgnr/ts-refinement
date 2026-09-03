import type { Refined } from "ts-refinement";
import type { ImportedAboveLimit } from "./captured.ts";

type Positive = Refined<number, "value > 0">;
type GreaterThanFive = Refined<number, "value > 5">;
type ExactlyFive = Refined<number, "value === 5">;
type UnderThousand = Refined<number, "value < 1e3">;
type NonEmpty = Refined<string, "value.length > 0">;
type AllPositive = Refined<number[], "values.every((item) => item > 0)">;
const LIMIT = 5 as const;
type AboveLimit = Refined<number, "value > LIMIT">;
type NestedPositive = { readonly value: Positive };
type NestedGreaterThanFive = { readonly value: GreaterThanFive };
type Pair = readonly [Positive, NonEmpty?, ...Positive[]];
type Scores = { readonly [name: string]: Positive };
type NumericScores = { readonly [key: number]: Positive };
type SymbolScores = { readonly [key: symbol]: Positive };
type DataScores = { readonly [key: `data-${string}`]: Positive };

interface User {
  readonly age: Positive;
  readonly name?: NonEmpty;
}

interface Box<Value> {
  readonly value: Value;
}

type Result =
  | { readonly kind: "count"; readonly count: Positive }
  | { readonly kind: "user"; readonly user: User };

interface Tree {
  readonly children: Tree[];
  readonly value: Positive;
}

interface RawTree {
  readonly children: RawTree[];
  readonly value: number;
}

declare const dynamic: number;
declare const dynamicArray: number[];
declare const dynamicCaptured: number;
declare const dynamicImportedCapture: number;
declare const greaterThanFive: GreaterThanFive;
declare const nestedGreaterThanFive: NestedGreaterThanFive;
declare const dynamicUser: { readonly age: number; readonly name?: string };
declare const dynamicValues: number[];
declare const dynamicPair: readonly [number, string?, ...number[]];
declare const dynamicScores: Readonly<Record<string, number>>;
declare const dynamicNumericScores: Readonly<Record<number, number>>;
declare const dynamicSymbolScores: { readonly [key: symbol]: number };
declare const dynamicDataScores: { readonly [key: `data-${string}`]: number };
declare const dynamicResult:
  | { readonly kind: "count"; readonly count: number }
  | { readonly kind: "user"; readonly user: { readonly age: number; readonly name?: string } };
declare const dynamicTree: RawTree;

export const knownGood = 5 as Positive;
export const knownUnderThousand = 5 as UnderThousand;
export const knownAllPositive = [1, 2, 3] as AllPositive;
export const knownCaptured = 6 as AboveLimit;
export const runtimeChecked = dynamic as Positive;
export const runtimeAllPositive = dynamicArray as AllPositive;
export const runtimeCaptured = dynamicCaptured as AboveLimit;
export const runtimeImportedCapture = dynamicImportedCapture as ImportedAboveLimit;
export const entailedAssignment: Positive = greaterThanFive;
export let entailedMutation: Positive = knownGood;
entailedMutation = greaterThanFive;

export function entailedReturn(): Positive {
  return greaterThanFive;
}

export function guardedAssertion(value: number): Positive {
  if (value > 0) return value as Positive;
  throw new Error("invalid");
}

export function guardedElse(value: number): ExactlyFive {
  if (value !== 5) throw new Error("invalid");
  else return value as ExactlyFive;
}

export function guardedConditional(value: number): Positive | null {
  return value > 0 ? (value as Positive) : null;
}

export function guardedAfterWrite(value: number): Positive {
  if (value > 0) {
    value = dynamic;
    return value as Positive;
  }
  throw new Error("invalid");
}

export const entailedArray: Positive[] = [greaterThanFive];
export const entailedProperty: NestedPositive = { value: greaterThanFive };
export const entailedCallback: () => Positive = () => greaterThanFive;
export const entailedCast = greaterThanFive as Positive;
export const entailedNested: NestedPositive = nestedGreaterThanFive;

function acceptPositive(_value: Positive): void {}
acceptPositive(greaterThanFive);

function acceptPositiveRest(..._values: Positive[]): void {}
acceptPositiveRest(greaterThanFive);

export const knownUser = { age: 5, name: "ok" } as User;
export const runtimeUser = dynamicUser as User;
export const runtimeValues = dynamicValues as Positive[];
export const runtimeBox = { value: dynamic } as Box<Positive>;
export const runtimePair = dynamicPair as Pair;
export const runtimeScores = dynamicScores as Scores;
export const runtimeNumericScores = dynamicNumericScores as NumericScores;
export const runtimeSymbolScores = dynamicSymbolScores as SymbolScores;
export const runtimeDataScores = dynamicDataScores as DataScores;
export const runtimeResult = dynamicResult as Result;
export const runtimeTree = dynamicTree as Tree;
