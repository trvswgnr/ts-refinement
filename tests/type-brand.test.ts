import { describe, expectTypeOf, it } from "vitest";

import type { Refined } from "ts-refinement-types";

type Int = Refined<number, "Number.isInteger(n)">;
type Even = Refined<Int, "n % 2 === 0">;

function verifyAssignments(numberValue: number, intValue: Int, evenValue: Even): void {
  // @ts-expect-error An unrefined number cannot be assigned across the boundary.
  const invalidInt: Int = numberValue;
  const numberFromInt: number = intValue;
  const intFromEven: Int = evenValue;
  void invalidInt;
  void numberFromInt;
  void intFromEven;
}

describe("Refined", () => {
  it("preserves the base and nested subtype relationships", () => {
    expectTypeOf<Int>().toExtend<number>();
    expectTypeOf<Even>().toExtend<Int>();
    expectTypeOf(verifyAssignments).toBeFunction();
  });
});
