import { expect, it } from "vitest";

import { checkPositive } from "./refinement-build.ts";

it("runs refinement validators from the published Vitest adapter", () => {
  expect(checkPositive(2)).toBe(2);
  expect(() => checkPositive(-1)).toThrowError(
    expect.objectContaining({ name: "RefinementError", value: -1 }),
  );
});
