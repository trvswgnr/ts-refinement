import type { Even } from "./types.ts";

declare const dynamic: number;

export const asKnownEven = 4 as Even;
export const angleKnownEven = <Even>4;
export const asRuntimeEven = dynamic as Even;
export const angleRuntimeEven = <Even>dynamic;
