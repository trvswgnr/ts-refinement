import { describe, expect, it } from "vitest";

import { RefinementError } from "@ts-refinement/runtime";

describe("RefinementError", () => {
  it("preserves metadata without serializing the value", () => {
    const value = { secret: "do-not-print" };
    const error = new RefinementError({ predicate: "n > 0", refinement: "Positive", value });

    expect(error).toBeInstanceOf(TypeError);
    expect(error.name).toBe("RefinementError");
    expect(error.message).toBe("Value failed refinement 'Positive': n > 0");
    expect(error.message).not.toContain("do-not-print");
    expect(error.value).toBe(value);
  });
});
