import type { Refined } from "ts-refinement";

type Positive = Refined<number, "value > 0">;
type NumericScores = { readonly [key: number]: Positive };

export const invalidNegative = { "-1": -1 } as NumericScores;
export const invalidFractional = { "1.5": -2 } as NumericScores;
