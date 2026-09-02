import type { Refined } from "ts-refinement";

export type Positive = Refined<number, "n > 0">;
export type Negative = Refined<number, "n < 0">;
export type PositiveByValue = Refined<number, "value > 0">;
export type GreaterThanFive = Refined<number, "n > 5">;
export type BetweenZeroAndTen = Refined<number, "n > 0 && n < 10">;
export type ExactlyFive = Refined<number, "n === 5">;
export type NonPositive = Refined<number, "n <= 0">;
export type Int = Refined<number, "Number.isInteger(n)">;
export type Even = Refined<Int, "n % 2 === 0">;
export type Broken = Refined<number, "n >">;
export type Ambiguous = Refined<number, "n > min">;
export type NonEmpty = Refined<string, "s.length > 0">;
export type Slug = Refined<string, "/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)">;
export type AllPositive = Refined<number[], "xs.every((x) => x > 0)">;
export type AllPositiveByItem = Refined<number[], "values.every((item) => item > 0)">;
export type ParameterNamedA = Refined<number[], "xs.every((a) => a >= 1 && a < 10)">;
export type ParameterNamedB = Refined<number[], "values.every((item) => item >= 1 && item < 10)">;
