import type { Refined } from "ts-refinement";

type Strong = Refined<number, "value > 5">;
type Weak = Refined<number, "value > 0">;
type StrongUser = { readonly age: Strong };
type WeakUser = { readonly age: Weak };

declare const strong: Strong;
declare const strongUser: StrongUser;

export const variable: Weak = strong;
export const cast = strong as Weak;

export class Holder {
  readonly value: Weak = strong;
}

function acceptsWeak(_value: Weak): void {}
acceptsWeak(strong);

export function returnsWeak(): Weak {
  return strong;
}

export const array: Weak[] = [strong];
export const object: { readonly value: Weak } = { value: strong };

let assigned: Weak;
assigned = strong;
export { assigned };

export const callback: () => Weak = () => strong;
export const nested: WeakUser = strongUser;
