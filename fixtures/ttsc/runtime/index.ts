import type { Refined } from "ts-refinement";

type Positive = Refined<number, "value > 0">;
type Pair = readonly [Positive, ...Positive[]];

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

export function checkTree(tree: RawTree): Tree {
  return tree as Tree;
}
