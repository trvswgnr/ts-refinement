import type { AllPositive, AllPositiveByItem, Even, Positive, PositiveByValue } from "./types.ts";

declare const dynamic: number;
declare const dynamicValues: number[];

export const knownGood = 5 as Positive;
export const knownEven = 4 as Even;
export const runtimePositive = dynamic as Positive;
export const runtimePositiveAgain = dynamic as PositiveByValue;
export const runtimeAllPositive = dynamicValues as AllPositive;
export const runtimeAllPositiveAgain = dynamicValues as AllPositiveByItem;

export function checkPositive(value: number): Positive {
  return value as Positive;
}

export function checkEven(value: number): Even {
  return value as Even;
}
