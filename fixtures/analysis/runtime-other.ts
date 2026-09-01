import type { PositiveByValue } from "./types.ts";

export function checkOther(value: number): PositiveByValue {
  return value as PositiveByValue;
}
