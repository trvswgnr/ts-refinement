import type { Refined } from "ts-refinement";

type Positive = Refined<number, "value > 0">;
type Strong = Refined<number, "value > 5">;
type AllPositive = Refined<number[], "values.every((item) => item > 0)">;
type MiddleRest = readonly [Positive, ...Positive[], Strong];
type RawMiddleRest = readonly [number, ...number[], number];
let MUTABLE_LIMIT = 5;
type AboveMutableLimit = Refined<number, "value > MUTABLE_LIMIT">;

interface User {
  readonly age: Positive;
}

declare const unknownValue: unknown;

export const knownBad = -1 as Positive;
export const knownBadValues = [1, -2] as AllPositive;
export const knownBadUser = { age: -5 } as User;
export const knownBadMiddleRest = [1, 2, 6, 1] as RawMiddleRest as MiddleRest;
export const unsafeUser = unknownValue as User;
export const invalidCapture = 6 as AboveMutableLimit;
