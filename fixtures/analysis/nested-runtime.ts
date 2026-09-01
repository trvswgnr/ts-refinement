import type { Even, Int } from "./types.ts";

export function checkNested(dynamicValue: number): Even {
  return ((dynamicValue as Int) + 2) as Even;
}
