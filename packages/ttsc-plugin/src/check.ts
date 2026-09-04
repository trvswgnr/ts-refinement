import { resolve } from "node:path";

import type { TtscPluginDescriptor, TtscPluginFactoryContext } from "./types.ts";

export default function refinementCheckPlugin(
  context: TtscPluginFactoryContext,
): TtscPluginDescriptor {
  return {
    capabilities: { lsp: true },
    name: "@ts-refinement/ttsc/check",
    reportsTypeScriptDiagnostics: true,
    source: resolve(context.dirname, "../native/check"),
    stage: "check",
  };
}
