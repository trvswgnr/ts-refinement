import type { Refined } from "ts-refinement";

type Dangerous = Refined<(source: string) => unknown, "eval('globalThis.PWNED = 1')">;

declare const dynamic: (source: string) => unknown;

export const dangerous = dynamic as Dangerous;
