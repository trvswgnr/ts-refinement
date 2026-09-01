import type { Refined } from "ts-refinement";

type Dangerous = Refined<number, "n > 0 && eval('globalThis.PWNED = 1')">;

declare const dynamic: number;

export const dangerous = dynamic as Dangerous;
