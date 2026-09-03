import type { Refined } from "ts-refinement";

export type Positive = Refined<number, "value > 0">;
