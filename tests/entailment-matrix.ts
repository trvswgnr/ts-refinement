import { expect } from "vitest";

const validAssignments = [
  "validStringToTemplate",
  "validTemplateToString",
  "validStringToNumber",
  "validNumberToString",
  "validTemplateToNarrowTemplate",
  "validNarrowTemplateToTemplate",
  "validSymbol",
  "validNamedToString",
  "validProperty",
  "validOptional",
  "validArray",
  "validTuple",
  "validOptionalTuple",
  "validRestTuple",
  "validMiddleRestTuple",
  "validMiddleRestToRest",
  "validGeneric",
  "validUnion",
  "validCallableProperty",
  "validParameter",
  "validRecursive",
  "validMutableArray",
  "validRequiredToOptionalTuple",
  "validShortToOptionalTuple",
  "validFixedToRestTuple",
  "validSatisfies",
  "validGenericCallable",
];

const invalidAssignments = [
  "invalidStringToTemplate",
  "invalidTemplateToString",
  "invalidStringToNumber",
  "invalidNumberToString",
  "invalidTemplateToNarrowTemplate",
  "invalidNarrowTemplateToTemplate",
  "invalidSymbol",
  "invalidNamedToString",
  "invalidProperty",
  "invalidOptional",
  "invalidArray",
  "invalidTuple",
  "invalidOptionalTuple",
  "invalidRestTuple",
  "invalidMiddleRestSuffix",
  "invalidGeneric",
  "invalidUnion",
  "invalidCallableProperty",
  "invalidParameter",
  "invalidRecursive",
  "invalidReadonlyArray",
  "invalidOptionalRequired",
  "invalidTupleLength",
  "invalidTupleMember",
  "invalidOptionalToRequiredTuple",
  "invalidRestToFixedTuple",
  "invalidTupleExtra",
  "invalidFixedToRestMember",
  "invalidSatisfies",
  "invalidGenericCallable",
  "invalidGenericConstraint",
  "invalidGenericArity",
];

export function expectEntailmentMatrixDiagnostics(output: string): void {
  for (const name of validAssignments) expect(output).not.toMatch(new RegExp(`\\b${name}\\b`, "u"));
  for (const name of invalidAssignments) expect(output).toMatch(new RegExp(`\\b${name}\\b`, "u"));
  expect(output).toContain("could be instantiated with an arbitrary type");
  expect(output).not.toContain("RF1000400");
}
