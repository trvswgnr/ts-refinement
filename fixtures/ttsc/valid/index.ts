import type { Refined } from "ts-refinement";

type Positive = Refined<number, "value > 0">;
type GreaterThanFive = Refined<number, "value > 5">;
type NonEmpty = Refined<string, "value.length > 0">;
type NestedPositive = { readonly value: Positive };
type NestedGreaterThanFive = { readonly value: GreaterThanFive };
type Pair = readonly [Positive, NonEmpty?, ...Positive[]];
type Scores = { readonly [name: string]: Positive };

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
declare const greaterThanFive: GreaterThanFive;
declare const nestedGreaterThanFive: NestedGreaterThanFive;
declare const dynamicUser: { readonly age: number; readonly name?: string };
declare const dynamicValues: number[];
declare const dynamicPair: readonly [number, string?, ...number[]];
declare const dynamicScores: Readonly<Record<string, number>>;
declare const dynamicResult:
  | { readonly kind: "count"; readonly count: number }
  | { readonly kind: "user"; readonly user: { readonly age: number; readonly name?: string } };
declare const dynamicTree: RawTree;

export const knownGood = 5 as Positive;
export const runtimeChecked = dynamic as Positive;
export const entailedAssignment: Positive = greaterThanFive;
export let entailedMutation: Positive = knownGood;
entailedMutation = greaterThanFive;

export function entailedReturn(): Positive {
  return greaterThanFive;
}

export const entailedArray: Positive[] = [greaterThanFive];
export const entailedProperty: NestedPositive = { value: greaterThanFive };
export const entailedCallback: () => Positive = () => greaterThanFive;
export const entailedCast = greaterThanFive as Positive;
export const entailedNested: NestedPositive = nestedGreaterThanFive;

function acceptPositive(_value: Positive): void {}
acceptPositive(greaterThanFive);

export const knownUser = { age: 5, name: "ok" } as User;
export const runtimeUser = dynamicUser as User;
export const runtimeValues = dynamicValues as Positive[];
export const runtimeBox = { value: dynamic } as Box<Positive>;
export const runtimePair = dynamicPair as Pair;
export const runtimeScores = dynamicScores as Scores;
export const runtimeResult = dynamicResult as Result;
export const runtimeTree = dynamicTree as Tree;
