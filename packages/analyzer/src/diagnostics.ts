export const DiagnosticCode = {
  InvalidExpression: 1000000,
  PredicateNotConcrete: 1000001,
  CannotInferSubject: 1000002,
  ExternalCapture: 1000003,
  UnsupportedRuntimeSyntax: 1000004,
  SourceNotAssignable: 1000101,
  StaticallyDisproven: 1000200,
  UnableToResolveMetadata: 1000400,
  PublishVerificationMissing: 1000500,
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
