import type { Refined } from "ts-refinement";

type Positive = Refined<number, "n > 0">;
type Int = Refined<number, "Number.isInteger(n)">;
type Even = Refined<Int, "n % 2 === 0">;

// SAFETY: the refinement transform statically proves both Even predicates for 4.
export const knownGood = 4 as Even;

export function positive(value: number): Positive {
  // SAFETY: the refinement transform inserts the Positive runtime check for dynamic values.
  return value as Positive;
}
