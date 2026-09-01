declare const refinementBrand: unique symbol;

type RefinementTags<Expression extends string> = {
  readonly [Key in Expression]: true;
};

/**
 * A subtype of `Base` whose predicate is established by the refinement build
 * tooling. The marker is erased completely at runtime.
 */
export type Refined<Base, Predicate extends string> = Base & {
  readonly [refinementBrand]: RefinementTags<Predicate>;
};
