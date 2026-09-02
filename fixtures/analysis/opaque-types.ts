import type { Refined } from "ts-refinement";

export type ObjectShorthand = Refined<number, "({ n }).n > 0">;
