import type { Refined } from "ts-refinement";

type Strong = Refined<number, "value > 5">;
type Weak = Refined<number, "value > 0">;

declare const broadStrong: { readonly [key: string]: Strong };
declare const broadWeak: { readonly [key: string]: Weak };

export const validTemplateTarget: { readonly [key: `data-${string}`]: Weak } = broadStrong;
export const invalidTemplateTarget: { readonly [key: `data-${string}`]: Strong } = broadWeak;
