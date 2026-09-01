import type { Ambiguous, Broken } from "./types.ts";

declare const value: number;

export const ambiguous = value as Ambiguous;
export const broken = value as Broken;
