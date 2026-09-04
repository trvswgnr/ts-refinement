import type { Refined } from "ts-refinement";

type Positive = Refined<number, "value > 0">;

export const importedBad = -1 as Positive;
