import type { Refined } from "ts-refinement";

type Strong = Refined<number, "value > 5">;
type Weak = Refined<number, "value > 0">;

declare const source: { readonly age: Strong; readonly getValue: () => string };

export const target: { readonly age: Weak; readonly getValue: () => number } = source;

declare const narrowParameterSource: { readonly setValue: (value: Strong) => void };
export const invalidParameterTarget: { readonly setValue: (value: Weak) => void } =
  narrowParameterSource;

declare const narrowRestSource: { readonly setValues: (...values: Strong[]) => void };
export const invalidRestTarget: {
  readonly setValues: (first: Strong, second: Weak) => void;
} = narrowRestSource;

interface WeakConstructor {
  readonly marker: Strong;
  new (): Weak;
}

interface StrongConstructorTarget {
  readonly marker: Weak;
  new (): Strong;
}

declare const weakConstructor: WeakConstructor;
export const invalidConstructorTarget: StrongConstructorTarget = weakConstructor;
