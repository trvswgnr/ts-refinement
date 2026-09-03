declare const refinementBrand: unique symbol;

type Refined<Base, Predicate extends string> = Base & {
  readonly [refinementBrand]: { readonly [Key in Predicate]: true };
};

declare const value: number;

export const localBrand = value as Refined<number, "value > 0">;
