import type * as ts from "typescript/lib/tsserverlibrary";

import { getRefinementDiagnostics } from "../../analyzer/src/index.ts";

const pluginName = "typescript-refinement-types";

function init(modules: { readonly typescript: typeof ts }): ts.server.PluginModule {
  const tsModule = modules.typescript;

  return {
    create(info): ts.LanguageService {
      const proxy: ts.LanguageService = { ...info.languageService };
      proxy.getSemanticDiagnostics = (fileName): ts.Diagnostic[] => {
        const existing = info.languageService.getSemanticDiagnostics(fileName);
        const program = info.languageService.getProgram();
        const sourceFile = program?.getSourceFile(fileName);
        if (program === undefined || sourceFile === undefined) return existing;

        const context = {
          checker: program.getTypeChecker(),
          program,
          ts: tsModule,
        };
        const refinements = getRefinementDiagnostics(context, sourceFile).map(
          (diagnostic): ts.Diagnostic => ({
            category: tsModule.DiagnosticCategory.Error,
            code: diagnostic.code,
            file: sourceFile,
            length: diagnostic.length,
            messageText: diagnostic.message,
            source: pluginName,
            start: diagnostic.start,
          }),
        );
        return [...existing, ...refinements];
      };
      return proxy;
    },
  };
}

export default init;
