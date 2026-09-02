export interface RefinementErrorOptions {
  readonly marker?: string;
  readonly path?: string;
  readonly predicate: string;
  readonly refinement?: string;
  readonly value: unknown;
}

export class RefinementError extends TypeError {
  override readonly name = "RefinementError";
  readonly marker: string | undefined;
  readonly path: string | undefined;
  readonly predicate: string;
  readonly refinement: string | undefined;
  readonly value: unknown;

  constructor(options: RefinementErrorOptions) {
    const label = options.refinement === undefined ? "" : ` '${options.refinement}'`;
    super(`Value failed refinement${label}: ${options.predicate}`);

    this.marker = options.marker;
    this.path = options.path;
    this.predicate = options.predicate;
    this.refinement = options.refinement;
    this.value = options.value;
  }
}
