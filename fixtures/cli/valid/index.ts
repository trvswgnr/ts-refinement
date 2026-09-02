import type { Refined } from "ts-refinement";

type Positive = Refined<number, "n > 0">;
type GreaterThanFive = Refined<number, "n > 5">;

declare const greaterThanFive: GreaterThanFive;

export const entailed: Positive = greaterThanFive;
