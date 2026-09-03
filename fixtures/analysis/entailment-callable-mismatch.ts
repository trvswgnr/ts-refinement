import type { Refined } from "ts-refinement";

type Strong = Refined<number, "value > 5">;
type Weak = Refined<number, "value > 0">;

declare const source: { readonly age: Strong; readonly getValue: () => string };

export const target: { readonly age: Weak; readonly getValue: () => number } = source;

declare const returnSource: { readonly getValue: () => Strong };
export const returnTarget: { readonly getValue: () => Weak } = returnSource;

declare const parameterSource: { readonly setValue: (value: Weak) => void };
export const parameterTarget: { readonly setValue: (value: Strong) => void } = parameterSource;

declare const narrowParameterSource: { readonly setValue: (value: Strong) => void };
export const invalidParameterTarget: { readonly setValue: (value: Weak) => void } =
  narrowParameterSource;
