import { RefinementError } from "@ts-refinement/runtime";

const error = new RefinementError({ predicate: "n > 0", value: -1 });
if (error.name !== "RefinementError") {
  throw new TypeError("The runtime package did not expose RefinementError.");
}
