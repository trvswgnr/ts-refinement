import type { Even, Positive, PositiveByValue } from "./types.ts";

declare const dynamic: number;

export const knownGood = 5 as Positive;
export const knownEven = 4 as Even;
export const runtimePositive = dynamic as Positive;
export const runtimePositiveAgain = dynamic as PositiveByValue;

export function checkPositive(value: number): Positive {
  return value as Positive;
}

export function checkEven(value: number): Even {
  return value as Even;
}
