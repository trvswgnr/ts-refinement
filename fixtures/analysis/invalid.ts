import type { Even, Positive } from "./types.ts";

declare const arbitrary: any;
declare const text: string;
declare const unknownValue: unknown;

export const negative = -5 as Positive;
export const odd = 5 as Even;
export const fromAny = arbitrary as Positive;
export const fromString = text as Positive;
export const fromUnknown = unknownValue as Positive;
