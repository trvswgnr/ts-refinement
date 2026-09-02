import type { Refined } from "ts-refinement";

type GreaterThanFive = Refined<number, "n > 5">;
type Positive = Refined<number, "n > 0">;
type PositiveByValue = Refined<number, "value > 0">;
type AtLeastOne = Refined<number, "n >= 1">;
type GreaterThanNegativeOne = Refined<number, "n > -1">;
type UnsupportedStrong = Refined<number, "Math.abs(n) > 5">;
type UnsupportedWeak = Refined<number, "Math.abs(n) > 0">;
type TrueNumber = Refined<number, "true">;
type TrueString = Refined<string, "true">;
type WithRequired = Positive & { readonly required: string };

declare const greaterThanFive: GreaterThanFive;
declare const positive: Positive;
declare const positiveByValue: PositiveByValue;
declare const atLeastOne: AtLeastOne;
declare const greaterThanNegativeOne: GreaterThanNegativeOne;
declare const unsupportedStrong: UnsupportedStrong;
declare const trueString: TrueString;

export const entailedAssignment: Positive = greaterThanFive;
export const normalizedSubjectAssignment: Positive = positiveByValue;
export const inverseAssignment: GreaterThanFive = positive;
export const unsupportedAssignment: UnsupportedWeak = unsupportedStrong;
export const incompatibleBaseAssignment: TrueNumber = trueString;
export const nonRefinementMismatch: WithRequired = greaterThanFive;

export const entailedCast = atLeastOne as GreaterThanNegativeOne;
export const inverseCast = greaterThanNegativeOne as AtLeastOne;

export const unrelatedDiagnostic: string = 123;
export function unmappableAssignment(): string {
  return 123;
}
export const missingName = unavailableName;
