import type { Refined } from "ts-refinement";

type Strong = Refined<number, "value > 5">;
type Weak = Refined<number, "value > 0">;
type MiddleRest = readonly [Weak, ...Weak[], Strong];
type RawMiddleRest = readonly [number, ...number[], number];

export function checkMiddleRest(value: RawMiddleRest): MiddleRest {
  return value as MiddleRest;
}
