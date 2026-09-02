export const DiagnosticCode = {
  InvalidExpression: 90000,
  PredicateNotConcrete: 90001,
  CannotInferSubject: 90002,
  ExternalCapture: 90003,
  UnsupportedRuntimeSyntax: 90004,
  SourceNotAssignable: 90101,
  StaticallyDisproven: 90200,
  UnableToResolveMetadata: 90400,
  PublishVerificationMissing: 90500,
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
  severity: RefinementDiagnosticSeverity = "error",
): RefinementDiagnostic {
  return {
    code,
    length: location.length,
    message: `${formatDiagnosticCode(code)}: ${message}`,
    severity,
    start: location.start,
  };
}
