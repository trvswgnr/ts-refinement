import type { Refined } from "ts-refinement";

type Strong = Refined<number, "value > 5">;
type Weak = Refined<number, "value > 0">;

declare const source: { readonly age: Strong; readonly getValue: () => string };

export const target: { readonly age: Weak; readonly getValue: () => number } = source;
