import type { Refined } from "ts-refinement";

type Positive = Refined<number, "n > 0">;
type GreaterThanFive = Refined<number, "n > 5">;

declare const positive: Positive;

export const inverse: GreaterThanFive = positive;
export const disproven = -1 as Positive;
export const unrelated: string = 123;
