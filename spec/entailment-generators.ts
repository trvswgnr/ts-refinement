import { array, constantFrom, integer, oneof, tuple } from "fast-check";

const numberAtom = oneof(
  tuple(constantFrom(">", ">=", "<", "<=", "==="), integer({ min: -20, max: 20 })).map(
    ([operator, bound]) => `n ${operator} ${bound}`,
  ),
  tuple(constantFrom(">", ">=", "<", "<="), integer({ min: -20, max: 20 })).map(
    ([operator, bound]) => `-n ${operator} ${bound}`,
  ),
  tuple(constantFrom(">", ">=", "<", "<="), integer({ min: -20, max: 20 })).map(
    ([operator, bound]) => `2 * n + 1 ${operator} ${bound}`,
  ),
  constantFrom(
    "Number.isFinite(n)",
    "Number.isInteger(n)",
    "!(n <= 0)",
    "n % 2 === 0",
    "n % 3 === 1",
  ),
);

export const numberPredicateSources = array(numberAtom, { maxLength: 3 });

export const generatedEntailmentInputs = tuple(numberPredicateSources, numberPredicateSources).map(
  ([source, target]) => ({ source, target }),
);
