import type { Refined } from "ts-refinement";

const IMPORTED_LIMIT = 7 as const;

export type ImportedAboveLimit = Refined<number, "value > IMPORTED_LIMIT">;
