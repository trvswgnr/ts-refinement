export const numberLiteral = 5;
export const negativeLiteral = -5;
export const stringLiteral = "value";
export const trueLiteral = true;
export const falseLiteral = false;
export const nullLiteral = null;
export const unaryLiteral = !0;
export const arithmetic = 2 + 3;
export const conditional = true ? 1 : 2;
export const arrayLiteral = [1, -2];
export const asserted = 3 as number;
export const satisfied = 4 satisfies number;

const literalTyped = 6 as const;
let widened = 7;

export const fromLiteralType = literalTyped;
export const fromWidenedType = widened;
export const spreadArray = [...arrayLiteral];
