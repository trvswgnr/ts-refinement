import type * as ts from "typescript";

import { refinementSemanticDiagnostics } from "./diagnostics.ts";

interface ProgramTransformerExtras {
  readonly ts: typeof ts;
}

interface ProgramTransformerOptions {
  readonly transformProgram?: boolean;
}

function allSemanticDiagnostics(
  tsModule: typeof ts,
  program: ts.Program,
  getExisting: () => readonly ts.Diagnostic[],
): ts.Diagnostic[] {
  const existing = getExisting();
  const byFile = new Map<ts.SourceFile, ts.Diagnostic[]>();
  const result = existing.filter((diagnostic) => diagnostic.file === undefined);
  for (const diagnostic of existing) {
    if (diagnostic.file === undefined) continue;
    const diagnostics = byFile.get(diagnostic.file) ?? [];
    diagnostics.push(diagnostic);
    byFile.set(diagnostic.file, diagnostics);
  }

  for (const [sourceFile, diagnostics] of byFile) {
    if (!sourceFile.isDeclarationFile && !program.isSourceFileFromExternalLibrary(sourceFile)) {
      result.push(...refinementSemanticDiagnostics(tsModule, program, sourceFile, diagnostics));
    } else {
      result.push(...diagnostics);
    }
  }
  for (const sourceFile of program.getSourceFiles()) {
    if (
      !sourceFile.isDeclarationFile &&
      !program.isSourceFileFromExternalLibrary(sourceFile) &&
      !byFile.has(sourceFile)
    ) {
      result.push(...refinementSemanticDiagnostics(tsModule, program, sourceFile, []));
    }
  }
  return result;
}

export default function transformProgram(
  program: ts.Program,
  _host: ts.CompilerHost | undefined,
  _options: ProgramTransformerOptions,
  extras: ProgramTransformerExtras,
): ts.Program {
  const getSemanticDiagnostics = program.getSemanticDiagnostics.bind(program);
  return new Proxy(program, {
    get(target, property) {
      if (property === "getSemanticDiagnostics") {
        return (
          sourceFile?: ts.SourceFile,
          cancellationToken?: ts.CancellationToken,
        ): readonly ts.Diagnostic[] => {
          if (sourceFile === undefined) {
            return allSemanticDiagnostics(extras.ts, target, () =>
              getSemanticDiagnostics(undefined, cancellationToken),
            );
          }
          return refinementSemanticDiagnostics(
            extras.ts,
            target,
            sourceFile,
            getSemanticDiagnostics(sourceFile, cancellationToken),
          );
        };
      }
      // SAFETY: A Proxy get key is a property key; keys outside Program resolve to undefined.
      return target[property as keyof ts.Program];
    },
  });
}
