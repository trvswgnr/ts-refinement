export const knownTrue = 1 as Positive;

export function checkDynamic(value = 0) {
  return value as Positive;
}

export function checkNested(value = 0) {
  return value as Integer as Positive;
}
