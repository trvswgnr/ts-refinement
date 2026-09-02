import type { Refined } from "ts-refinement";

export type Configured = Refined<number, "n > 0">;
