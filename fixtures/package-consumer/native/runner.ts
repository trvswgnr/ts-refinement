import type { Refined } from "ts-refinement";

type Positive = Refined<number, "value > 0">;

if ((Number("2") as Positive) !== 2) throw new Error("valid refinement changed value");
Number("-1") as Positive;
