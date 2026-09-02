import type * as ts from "typescript";

import {
  filterEntailedRefinementDiagnostics,
  getRefinementDiagnostics,
} from "@ts-refinement/analyzer";

export const pluginName = "ts-refinement";

export function refinementSemanticDiagnostics(
  tsModule: typeof ts,
  program: ts.Program,
  sourceFile: ts.SourceFile,
  existing: readonly ts.Diagnostic[],
): ts.Diagnostic[] {
  const context = { checker: program.getTypeChecker(), program, ts: tsModule };
  const filtered = filterEntailedRefinementDiagnostics(context, sourceFile, existing);
  const refinements = getRefinementDiagnostics(context, sourceFile).map(
    (diagnostic): ts.Diagnostic => ({
      category:
        diagnostic.severity === "warning"
          ? tsModule.DiagnosticCategory.Warning
          : tsModule.DiagnosticCategory.Error,
      code: diagnostic.code,
      file: sourceFile,
      length: diagnostic.length,
      messageText: diagnostic.message,
      source: pluginName,
      start: diagnostic.start,
    }),
  );
  return [...filtered, ...refinements];
}
