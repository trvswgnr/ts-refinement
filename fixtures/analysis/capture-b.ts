import type { Refined } from "ts-refinement";

const LIMIT = 5 as const;

export type CapturedB = Refined<number, "n >= LIMIT">;
