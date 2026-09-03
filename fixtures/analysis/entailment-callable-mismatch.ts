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

declare const broadRestSource: { readonly setValues: (...values: Weak[]) => void };
export const validRestTarget: {
  readonly setValues: (first: Strong, second: Weak) => void;
} = broadRestSource;

declare const narrowRestSource: { readonly setValues: (...values: Strong[]) => void };
export const invalidRestTarget: {
  readonly setValues: (first: Strong, second: Weak) => void;
} = narrowRestSource;

declare const broadTupleRestSource: {
  readonly setValues: (...values: [Weak, Weak]) => void;
};
export const validTupleRestTarget: {
  readonly setValues: (...values: [Strong, Weak]) => void;
} = broadTupleRestSource;

declare const narrowTupleRestSource: {
  readonly setValues: (...values: [Strong, Strong]) => void;
};
export const invalidTupleRestTarget: {
  readonly setValues: (...values: [Strong, Weak]) => void;
} = narrowTupleRestSource;

interface BroadConstructor {
  readonly marker: Strong;
  new (): Strong;
}

interface WeakConstructorTarget {
  readonly marker: Weak;
  new (): Weak;
}

declare const broadConstructor: BroadConstructor;
export const validConstructorTarget: WeakConstructorTarget = broadConstructor;

interface NarrowConstructorTarget {
  readonly marker: Weak;
  new (): Strong;
}

declare const weakConstructor: WeakConstructorTarget;
export const invalidConstructorTarget: NarrowConstructorTarget = weakConstructor;
