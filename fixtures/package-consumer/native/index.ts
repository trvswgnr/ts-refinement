import type { Refined } from "ts-refinement";

type Positive = Refined<number, "value > 0">;

declare const dynamic: number;

export const known = 5 as Positive;
export const checked = dynamic as Positive;
