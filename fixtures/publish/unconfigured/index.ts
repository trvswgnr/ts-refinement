import type { Refined } from "ts-refinement";

export * from "./barrel-source";

declare namespace ThirdParty {
  const refinementBrand: unique symbol;
  type Refined<Base> = Base & { readonly [refinementBrand]: true };
  type Branded = Refined<number>;
}

type Internal = Refined<number, "n > 0">;
type ExportAlias = Internal;
type NotExported = { readonly value: Internal };

declare const refined: Internal;

export type Direct = Internal;
export type Nested = ReadonlyArray<{ readonly value: Internal }>;
export type Accumulated = Internal & Refined<number, "n < 10">;
export type { ExportAlias as PublicAlias };

export function inferred() {
  return refined;
}

export function accepts(value: Internal): number {
  return value;
}

export type OrdinaryBrand = number & { readonly __brand: "ordinary" };
export type LookalikeRefined = ThirdParty.Branded;
export default refined;
