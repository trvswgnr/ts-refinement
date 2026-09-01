export interface RefinementErrorOptions {
  readonly predicate: string;
  readonly refinement?: string;
  readonly value: unknown;
}

export class RefinementError extends TypeError {
  override readonly name = "RefinementError";
  readonly predicate: string;
  readonly refinement: string | undefined;
  readonly value: unknown;

  constructor(options: RefinementErrorOptions) {
    const label = options.refinement === undefined ? "" : ` '${options.refinement}'`;
    super(`Value failed refinement${label}: ${options.predicate}`);

    this.predicate = options.predicate;
    this.refinement = options.refinement;
    this.value = options.value;
  }
}
