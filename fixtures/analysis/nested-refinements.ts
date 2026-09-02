import type { Refined } from "ts-refinement";

type Positive = Refined<number, "value > 0">;
type NonEmpty = Refined<string, "value.length > 0">;

interface User {
  readonly age: Positive;
  readonly name?: NonEmpty;
}

interface Box<Value> {
  readonly value: Value;
}

type Pair = readonly [Positive, NonEmpty?, ...Positive[]];
type Result =
  | { readonly kind: "count"; readonly count: Positive }
  | { readonly kind: "user"; readonly user: User };
type Scores = { readonly [name: string]: Positive };

interface Tree {
  readonly children: Tree[];
  readonly value: Positive;
}

interface RawTree {
  readonly children: RawTree[];
  readonly value: number;
}

export function checkUser(user: { readonly age: number; readonly name?: string }): User {
  return user as User;
}

export function checkValues(values: number[]): Positive[] {
  return values as Positive[];
}

export function checkBox(box: { readonly value: number }): Box<Positive> {
  return box as Box<Positive>;
}

export function checkPair(pair: readonly [number, string?, ...number[]]): Pair {
  return pair as Pair;
}

export function checkResult(
  result:
    | { readonly kind: "count"; readonly count: number }
    | { readonly kind: "user"; readonly user: { readonly age: number; readonly name?: string } },
): Result {
  return result as Result;
}

export function checkScores(scores: Readonly<Record<string, number>>): Scores {
  return scores as Scores;
}

export function checkTree(tree: RawTree): Tree {
  return tree as Tree;
}
