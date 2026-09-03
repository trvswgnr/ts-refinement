import type { Refined } from "ts-refinement";

type Positive = Refined<number, "value > 0">;
type AllPositive = Refined<number[], "values.every((item) => item > 0)">;
let MUTABLE_LIMIT = 5;
type AboveMutableLimit = Refined<number, "value > MUTABLE_LIMIT">;

interface User {
  readonly age: Positive;
}

declare const unknownValue: unknown;

export const knownBad = -1 as Positive;
export const knownBadValues = [1, -2] as AllPositive;
export const knownBadUser = { age: -5 } as User;
export const unsafeUser = unknownValue as User;
export const invalidCapture = 6 as AboveMutableLimit;
