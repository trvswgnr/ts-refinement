export class RefinementError extends TypeError {
  constructor(options) {
    super("Refinement failed");
    this.name = "RefinementError";
    this.predicate = options.predicate;
    this.refinement = options.refinement;
    this.value = options.value;
  }
}
