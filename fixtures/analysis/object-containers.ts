import type { Refined } from "ts-refinement";

type Positive = Refined<number, "value > 0">;
type CallablePositive = (() => void) & { readonly value: Positive };
type OptionalPositive = { readonly value?: Positive };

export function checkCallable(value: () => void): CallablePositive {
  return value as CallablePositive;
}

export function checkOptional(value: {}): OptionalPositive {
  return value as OptionalPositive;
}
