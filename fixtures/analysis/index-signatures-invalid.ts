import type { Refined } from "ts-refinement";

type Positive = Refined<number, "value > 0">;
type NumericScores = { readonly [key: number]: Positive };
type DataScores = { readonly [key: `data-${string}`]: Positive };

export const invalidNegative = { "-1": -1 } as NumericScores;
export const invalidFractional = { "1.5": -2 } as NumericScores;
export const invalidTemplate = { "data-bad": -3 } as DataScores;
export const validTemplate = { "data-ok": 1, other: -1 } as DataScores;
