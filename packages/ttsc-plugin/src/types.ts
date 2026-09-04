export interface TtscPluginDescriptor {
  readonly capabilities?: {
    readonly lsp?: boolean;
  };
  readonly name: string;
  readonly reportsTypeScriptDiagnostics?: boolean;
  readonly source: string;
  readonly stage: "check" | "transform";
}

export interface TtscPluginFactoryContext {
  readonly dirname: string;
}
