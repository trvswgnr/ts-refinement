import type { Refined } from "ts-refinement";

type Positive = Refined<number, "value > 0">;
type Strong = Refined<number, "value > 5">;
type NonEmpty = Refined<string, "value.length > 0">;
type MiddleRest = readonly [Positive, ...Positive[], Strong];

interface User {
  readonly age: Positive;
  readonly name: NonEmpty;
}

export const badUser = { age: -5, name: "" } as User;
export const badValues = [-1, -2] as Positive[];
export const badMiddleRest = [1, 2, 6, 1] as MiddleRest;
