export function checkInlineImport(value: number) {
  return value as import("ts-refinement").Refined<number, "value > 0">;
}
