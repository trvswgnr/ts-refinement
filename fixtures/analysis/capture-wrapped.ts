import type { CapturedA } from "./capture-a.ts";
import type { CapturedB } from "./capture-b.ts";

export type WrappedCapturedA = CapturedA;
export type AccumulatedCaptures = CapturedA & CapturedB;
