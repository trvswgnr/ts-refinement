import type { Refined } from "ts-refinement";

import { IMPORTED_LIMIT } from "./capture-shared.ts";

const MIN_AGE = 18 as const;
const NEGATIVE = -3 as const;
const ESCAPED = 'line\n"quote' as const;
const ENABLED = true as const;
const BIG_LIMIT = 42n as const;

export type MinimumAge = Refined<number, "n >= MIN_AGE">;
export type ExplicitMinimumAge = Refined<number, "n >= 18">;
export type AboveNegative = Refined<number, "n > NEGATIVE">;
export type EscapedValue = Refined<string, "s === ESCAPED">;
export type EnabledNumber = Refined<number, "(n > 0) === ENABLED">;
export type BelowBigLimit = Refined<bigint, "n < BIG_LIMIT">;
export type ImportedMinimum = Refined<number, "n >= IMPORTED_LIMIT">;
