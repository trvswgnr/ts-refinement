import type { Refined } from "ts-refinement";

import { IMPORTED_BROAD } from "./capture-shared.ts";
import { MISSING_CAPTURE } from "./capture-missing.ts";

let MUTABLE = 1 as const;
const FUNCTION = () => 1;
const OBJECT = { value: 1 } as const;
const ARRAY = [1] as const;
const BROAD: number = 1;
const ASSERTED = Math.random() as 1;
declare const AMBIENT: 1;

export type MutableCapture = Refined<number, "n > MUTABLE">;
export type FunctionCapture = Refined<number, "n > FUNCTION">;
export type ObjectCapture = Refined<number, "n > OBJECT">;
export type ArrayCapture = Refined<number, "n > ARRAY">;
export type BroadCapture = Refined<number, "n > BROAD">;
export type ImportedBroadCapture = Refined<number, "n > IMPORTED_BROAD">;
export type MissingImportCapture = Refined<number, "n > MISSING_CAPTURE">;
export type AssertedCapture = Refined<number, "n > ASSERTED">;
export type AmbientCapture = Refined<number, "n > AMBIENT">;
export type Ambiguous = Refined<number, "left > right">;
