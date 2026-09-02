import type { Refined } from "ts-refinement";

export type PrivateRefinement = Refined<number, "n > 0">;
