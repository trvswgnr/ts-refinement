import type { Refined } from "ts-refinement-types";

export function genericRefinement<Predicate extends string>(value: number) {
  return value as Refined<number, Predicate>;
}
