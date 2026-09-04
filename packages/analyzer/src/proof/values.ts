export interface StaticObjectValue {
  [key: string]: StaticRuntimeValue;
}

export type StaticRuntimeValue =
  | bigint
  | boolean
  | null
  | number
  | string
  | undefined
  | readonly StaticRuntimeValue[]
  | StaticObjectValue;

export type StaticValue =
  | { readonly known: false }
  | { readonly known: true; readonly value: StaticRuntimeValue };

export const unknownValue: StaticValue = { known: false };

export function knownValue(value: StaticRuntimeValue): StaticValue {
  return { known: true, value };
}

export function isStaticObjectValue(value: StaticRuntimeValue): value is StaticObjectValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function displayStaticValue(value: StaticRuntimeValue): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return `${value}n`;
  if (Array.isArray(value)) return `[${value.map(displayStaticValue).join(", ")}]`;
  if (isStaticObjectValue(value)) {
    return `{ ${Object.entries(value)
      .map(([name, child]) => `${JSON.stringify(name)}: ${displayStaticValue(child)}`)
      .join(", ")} }`;
  }
  if (value === undefined) return "undefined";
  if (Object.is(value, -0)) return "-0";
  return String(value);
}
