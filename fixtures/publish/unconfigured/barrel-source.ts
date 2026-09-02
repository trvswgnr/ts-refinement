import type { Refined } from "ts-refinement";

export type StarRefined = Refined<string, "s.length > 0">;
