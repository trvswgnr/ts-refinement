import type { Refined } from "ts-refinement";

const LIMIT = 2 as const;

export type CapturedA = Refined<number, "n >= LIMIT">;
