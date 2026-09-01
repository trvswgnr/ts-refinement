import type { Refined } from "ts-refinement";

export type Positive = Refined<number, "n > 0">;
export type Negative = Refined<number, "n < 0">;
export type PositiveByValue = Refined<number, "value > 0">;
export type Int = Refined<number, "Number.isInteger(n)">;
export type Even = Refined<Int, "n % 2 === 0">;
export type Broken = Refined<number, "n >">;
export type Ambiguous = Refined<number, "n > min">;
export type NonEmpty = Refined<string, "s.length > 0">;
export type Slug = Refined<string, "/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)">;
export type AllPositive = Refined<number[], "xs.every((x) => x > 0)">;
export type AllPositiveByItem = Refined<number[], "values.every((item) => item > 0)">;
export type ParameterNamedA = Refined<
  number[],
  'xs.every(a => String.call(null, a => 1).includes("a"))'
>;
export type ParameterNamedB = Refined<
  number[],
  'xs.every(b => String.call(null, b => 1).includes("a"))'
>;
