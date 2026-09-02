import type { CapturedA } from "./capture-a.ts";
import type { CapturedB } from "./capture-b.ts";
import type {
  AboveNegative,
  BelowBigLimit,
  EnabledNumber,
  EscapedValue,
  ExplicitMinimumAge,
  ImportedMinimum,
  MinimumAge,
} from "./capture-types.ts";
import type { AccumulatedCaptures, WrappedCapturedA } from "./capture-wrapped.ts";

declare const numberValue: number;
declare const stringValue: string;
declare const bigintValue: bigint;

export const capturedA = numberValue as CapturedA;
export const capturedB = numberValue as CapturedB;
export const minimumAge = numberValue as MinimumAge;
export const explicitMinimumAge = numberValue as ExplicitMinimumAge;
export const aboveNegative = numberValue as AboveNegative;
export const escapedValue = stringValue as EscapedValue;
export const enabledNumber = numberValue as EnabledNumber;
export const belowBigLimit = bigintValue as BelowBigLimit;
export const importedMinimum = numberValue as ImportedMinimum;
export const wrappedCapturedA = numberValue as WrappedCapturedA;
export const accumulatedCaptures = numberValue as AccumulatedCaptures;
