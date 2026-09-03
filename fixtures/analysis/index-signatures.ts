import type { Refined } from "ts-refinement";

type Positive = Refined<number, "value > 0">;
type NumericScores = { readonly [key: number]: Positive };
type SymbolScores = { readonly [key: symbol]: Positive };
type DataScores = { readonly [key: `data-${string}`]: Positive };

export function checkNumericScores(scores: Readonly<Record<number, number>>): NumericScores {
  return scores as NumericScores;
}

export function checkSymbolScores(scores: { readonly [key: symbol]: number }): SymbolScores {
  return scores as SymbolScores;
}

export function checkDataScores(scores: { readonly [key: `data-${string}`]: number }): DataScores {
  return scores as DataScores;
}
