import type { Refined } from "ts-refinement";

declare global {
  type Positive = Refined<number, "n > 0">;
  type Integer = Refined<number, "Number.isInteger(n)">;
}

export {};
