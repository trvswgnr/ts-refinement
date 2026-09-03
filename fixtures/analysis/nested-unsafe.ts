import type { Refined } from "ts-refinement";

type Positive = Refined<number, "value > 0">;

interface User {
  readonly age: Positive;
}

declare const arbitrary: any;
declare const unknownValue: unknown;

export const fromAny = arbitrary as User;
export const fromUnknown = unknownValue as User;
