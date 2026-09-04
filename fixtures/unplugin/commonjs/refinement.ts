import type { Refined } from "ts-refinement";

type Positive = Refined<number, "value > 0">;

export function checkPositive(value: number): Positive {
  return value as Positive;
}
