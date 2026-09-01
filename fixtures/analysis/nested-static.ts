import type { Positive } from "./types.ts";

export const invalid = ((5 as Positive) - 5) as Positive;
