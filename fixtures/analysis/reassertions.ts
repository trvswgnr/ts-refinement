import type { Refined } from "ts-refinement";

type Positive = Refined<number, "n > 0">;
type GreaterThanFive = Refined<number, "n > 5">;
type LessThanTen = Refined<number, "n < 10">;
type BetweenZeroAndTen = Refined<number, "n > 0 && n < 10">;
type StartsWithA = Refined<string, 's.startsWith("a")'>;

declare const positive: Positive;
declare const greaterThanFive: GreaterThanFive;
declare const bounded: Positive & LessThanTen;
declare const startsWithA: StartsWithA;

export const exact = positive as Positive;
export const stronger = greaterThanFive as Positive;
export const accumulated = bounded as BetweenZeroAndTen;
export const unsupportedIdentity = startsWithA as StartsWithA;
export const weaker = positive as GreaterThanFive;

export function unresolvedSource<Predicate extends string>(value: Refined<number, Predicate>) {
  return value as Positive;
}
