import { describe, it, expect, expectTypeOf } from "vitest";

describe("test", () => {
  it("should pass", () => {
    expect(true).toBe(true);
    expectTypeOf(true).toEqualTypeOf<boolean>();
  });
});
