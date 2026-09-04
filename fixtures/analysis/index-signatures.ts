import type { Refined } from "ts-refinement";

type Positive = Refined<number, "value > 0">;
type NumericScores = { readonly [key: number]: Positive };
type SymbolScores = { readonly [key: symbol]: Positive };
type DataScores = { readonly [key: `data-${string}`]: Positive };
type NumericDataScores = { readonly [key: `number-${number}`]: Positive };
type BigIntDataScores = { readonly [key: `bigint-${bigint}`]: Positive };

export function checkNumericScores(scores: Readonly<Record<number, number>>): NumericScores {
  return scores as NumericScores;
}

export function checkSymbolScores(scores: { readonly [key: symbol]: number }): SymbolScores {
  return scores as SymbolScores;
}

export function checkDataScores(scores: { readonly [key: `data-${string}`]: number }): DataScores {
  return scores as DataScores;
}

export function checkNumericDataScores(scores: {
  readonly [key: `number-${number}`]: number;
}): NumericDataScores {
  return scores as NumericDataScores;
}

export function checkBigIntDataScores(scores: {
  readonly [key: `bigint-${bigint}`]: number;
}): BigIntDataScores {
  return scores as BigIntDataScores;
}
