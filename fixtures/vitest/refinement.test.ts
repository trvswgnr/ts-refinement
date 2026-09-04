import { expect, it } from "vitest";

import { checkDynamic } from "../unplugin/entry.ts";

it("runs refinement validators", () => {
  expect(checkDynamic(1)).toBe(1);
  expect(() => checkDynamic(-1)).toThrowError("Refinement failed");
});
