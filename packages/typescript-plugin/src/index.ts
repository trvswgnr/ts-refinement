import type * as ts from "typescript/lib/tsserverlibrary";

import { refinementSemanticDiagnostics } from "./diagnostics.ts";

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

        return refinementSemanticDiagnostics(tsModule, program, sourceFile, existing);
      };
      return proxy;
    },
  };
}

export default init;
