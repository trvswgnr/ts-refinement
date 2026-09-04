import type { Refined } from "ts-refinement";

type Strong = Refined<number, "value > 5">;
type Weak = Refined<number, "value > 0">;

declare const broadStrong: { readonly [key: string]: Strong };
declare const broadWeak: { readonly [key: string]: Weak };
declare const numericStrong: { readonly [key: number]: Strong };
declare const numericWeak: { readonly [key: number]: Weak };
declare const symbolStrong: { readonly [key: symbol]: Strong };
declare const symbolWeak: { readonly [key: symbol]: Weak };
declare const dataStrong: { readonly [key: `data-${string}`]: Strong };
declare const dataWeak: { readonly [key: `data-${string}`]: Weak };
declare const numericDataStrong: { readonly [key: `data-${number}`]: Strong };
declare const numericDataWeak: { readonly [key: `data-${number}`]: Weak };
declare const namedStrong: { readonly value: Strong };
declare const namedWeak: { readonly value: Weak };

export const validStringToTemplate: { readonly [key: `data-${string}`]: Weak } = broadStrong;
export const invalidStringToTemplate: { readonly [key: `data-${string}`]: Strong } = broadWeak;
export const validTemplateToString: { readonly [key: string]: Weak } = dataStrong;
export const invalidTemplateToString: { readonly [key: string]: Strong } = dataWeak;
export const validStringToNumber: { readonly [key: number]: Weak } = broadStrong;
export const invalidStringToNumber: { readonly [key: number]: Strong } = broadWeak;
export const validNumberToString: { readonly [key: string]: Weak } = numericStrong;
export const invalidNumberToString: { readonly [key: string]: Strong } = numericWeak;
export const validTemplateToNarrowTemplate: {
  readonly [key: `data-${number}`]: Weak;
} = dataStrong;
export const invalidTemplateToNarrowTemplate: {
  readonly [key: `data-${number}`]: Strong;
} = dataWeak;
export const validNarrowTemplateToTemplate: {
  readonly [key: `data-${string}`]: Weak;
} = numericDataStrong;
export const invalidNarrowTemplateToTemplate: {
  readonly [key: `data-${string}`]: Strong;
} = numericDataWeak;
export const validSymbol: { readonly [key: symbol]: Weak } = symbolStrong;
export const invalidSymbol: { readonly [key: symbol]: Strong } = symbolWeak;
export const validNamedToString: { readonly [key: string]: Weak } = namedStrong;
export const invalidNamedToString: { readonly [key: string]: Strong } = namedWeak;
