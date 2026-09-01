import { checkOther } from "./runtime-other.ts";
import type { AllPositive, Even, Negative, NonEmpty, Positive, Slug } from "./types.ts";

export const knownGood = 5 as Positive;
export const knownNonEmpty = "a" as NonEmpty;
export { checkOther };

export function checkPositive(value: number): Positive {
  return value as Positive;
}

export function checkEven(value: number): Even {
  return value as Even;
}

export function checkFromFactory(factory: () => number): Positive {
  return factory() as Positive;
}

export function checkSlug(value: string): Slug {
  return value as Slug;
}

export function checkAllPositive(value: number[]): AllPositive {
  return value as AllPositive;
}

export function checkConflicting(value: number): Negative {
  return value as Positive as Negative;
}
