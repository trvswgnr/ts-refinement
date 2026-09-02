export const DiagnosticCode = {
  InvalidExpression: 1000,
  PredicateNotConcrete: 1001,
  CannotInferSubject: 1002,
  ExternalCapture: 1003,
  UnsupportedRuntimeSyntax: 1004,
  SourceNotAssignable: 1101,
  StaticallyDisproven: 1200,
  UnableToResolveMetadata: 1400,
} as const;

export type RefinementDiagnosticSeverity = "error" | "warning";

export interface RefinementDiagnostic {
  readonly code: number;
  readonly length: number;
  readonly message: string;
  readonly severity: RefinementDiagnosticSeverity;
  readonly start: number;
}

export interface DiagnosticLocation {
  readonly length: number;
  readonly start: number;
}

export function formatDiagnosticCode(code: number): string {
  return `RF${code}`;
}

export function createDiagnostic(
  code: number,
  message: string,
  location: DiagnosticLocation,
): RefinementDiagnostic {
  return {
    code,
    length: location.length,
    message: `${formatDiagnosticCode(code)}: ${message}`,
    severity: "error",
    start: location.start,
  };
}
