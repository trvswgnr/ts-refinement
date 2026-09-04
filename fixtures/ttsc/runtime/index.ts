import type { Refined } from "ts-refinement";

type Positive = Refined<number, "value > 0">;
type Strong = Refined<number, "value > 5">;
type Pair = readonly [Positive, ...Positive[]];
type MiddleRest = readonly [Positive, ...Positive[], Strong];
type Scores = Readonly<Record<string, Positive>>;
type CallablePositive = (() => void) & { readonly value: Positive };
type OptionalPositive = { readonly value?: Positive };
const LIMIT = 1 as const;
type CapturedEvery = Refined<number[], "values.every((LIMIT) => LIMIT > 0) && LIMIT > 0">;
type SubjectShadowedEvery = Refined<number[], "value.every((value) => value > 0)">;

interface Tree {
  readonly children: Tree[];
  readonly value: Positive;
}

interface RawTree {
  readonly children: RawTree[];
  readonly value: number;
}

export function checkValues(values: number[]): Positive[] {
  return values as Positive[];
}

export function checkPair(pair: readonly [number, ...number[]]): Pair {
  return pair as Pair;
}

export function checkMiddleRest(value: readonly [number, ...number[], number]): MiddleRest {
  return value as MiddleRest;
}

export function checkCallable(value: () => void): CallablePositive {
  return value as CallablePositive;
}

export function checkOptional(value: {}): OptionalPositive {
  return value as OptionalPositive;
}

export function checkScores(scores: Readonly<Record<string, number>>): Scores {
  return scores as Scores;
}

export function checkCapturedEvery(values: number[]): CapturedEvery {
  return values as CapturedEvery;
}

export function checkSubjectShadowedEvery(values: number[]): SubjectShadowedEvery {
  return values as SubjectShadowedEvery;
}

export function checkTree(tree: RawTree): Tree {
  return tree as Tree;
}
