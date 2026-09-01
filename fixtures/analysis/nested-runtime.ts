import type { Even, Int } from "./types.ts";

export function checkNested(dynamicValue: number): Even {
  return ((dynamicValue as Int) + 2) as Even;
}

export function checkChained(dynamicValue: number): Even {
  return dynamicValue as Int as Even;
}

// oxfmt-ignore
export function checkNestedAngle(dynamicValue: number): Even {
  return <Even><Int>dynamicValue;
}

// oxfmt-ignore
export function checkAngleThenAs(dynamicValue: number): Even {
  return <Int>dynamicValue as Even;
}
