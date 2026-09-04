import type { Refined } from "ts-refinement";

type Positive = Refined<number, "value > 0">;
type Pair = readonly [Positive, ...Positive[]];
type Scores = Readonly<Record<string, Positive>>;
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
