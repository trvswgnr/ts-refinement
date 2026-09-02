import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import ts from "typescript/lib/tsserverlibrary";

import init from "../packages/typescript-plugin/src/index.ts";

import { fixtureDirectory, fixtureFile } from "./helpers.ts";

function createLanguageService(): ts.LanguageService {
  const configPath = fixtureFile("tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, fixtureDirectory);
  const versions = new Map(parsed.fileNames.map((fileName) => [fileName, "0"]));
  const host: ts.LanguageServiceHost = {
    fileExists: ts.sys.fileExists,
    getCompilationSettings: () => parsed.options,
    getCurrentDirectory: () => fixtureDirectory,
    getDefaultLibFileName: ts.getDefaultLibFilePath,
    getScriptFileNames: () => parsed.fileNames,
    getScriptSnapshot: (fileName) => ts.ScriptSnapshot.fromString(readFileSync(fileName, "utf8")),
    getScriptVersion: (fileName) => versions.get(fileName) ?? "0",
    readDirectory: ts.sys.readDirectory,
    readFile: ts.sys.readFile,
  };
  return ts.createLanguageService(host);
}

describe("TypeScript language-service plugin", () => {
  it("adds the same diagnostics as the build analyzer", () => {
    const languageService = createLanguageService();
    const plugin = init({ typescript: ts });
    // SAFETY: the plugin only reads languageService from this focused test double.
    const proxy = plugin.create({
      config: {},
      languageService,
      languageServiceHost: {},
      project: {},
      serverHost: ts.sys,
    } as ts.server.PluginCreateInfo);

    const diagnostics = proxy
      .getSemanticDiagnostics(fixtureFile("invalid.ts"))
      .filter((diagnostic) => diagnostic.source === "ts-refinement");
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      1200, 1200, 1101, 1101, 1101,
    ]);
    expect(diagnostics[0]?.messageText).toContain("RF1200");

    const declarationDiagnostics = proxy
      .getSemanticDiagnostics(fixtureFile("types.ts"))
      .filter((diagnostic) => diagnostic.source === "ts-refinement");
    expect(declarationDiagnostics.map((diagnostic) => diagnostic.code)).toEqual([1000, 1002]);
  });

  it("suppresses brand diagnostics only for proven refinement entailment", () => {
    const languageService = createLanguageService();
    const getSemanticDiagnostics = languageService.getSemanticDiagnostics.bind(languageService);
    let originalDiagnostics: readonly ts.Diagnostic[] = [];
    languageService.getSemanticDiagnostics = (fileName) => {
      originalDiagnostics = getSemanticDiagnostics(fileName);
      return [...originalDiagnostics];
    };

    const plugin = init({ typescript: ts });
    // SAFETY: the plugin only reads languageService from this focused test double.
    const proxy = plugin.create({
      config: {},
      languageService,
      languageServiceHost: {},
      project: {},
      serverHost: ts.sys,
    } as ts.server.PluginCreateInfo);

    const diagnostics = proxy.getSemanticDiagnostics(fixtureFile("entailment-diagnostics.ts"));
    const typescriptDiagnostics = diagnostics.filter(
      (diagnostic) => diagnostic.source !== "ts-refinement",
    );

    expect(originalDiagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      2322, 2322, 2322, 2322, 2322, 2322, 2352, 2352, 2322, 2322, 2304,
    ]);
    expect(typescriptDiagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      2322, 2322, 2322, 2322, 2352, 2322, 2322, 2304,
    ]);
    const expectedDiagnostics = [
      originalDiagnostics[2],
      originalDiagnostics[3],
      originalDiagnostics[4],
      originalDiagnostics[5],
      originalDiagnostics[7],
      originalDiagnostics[8],
      originalDiagnostics[9],
      originalDiagnostics[10],
    ];
    expect(typescriptDiagnostics).toEqual(expectedDiagnostics);
    typescriptDiagnostics.forEach((diagnostic, index) => {
      expect(diagnostic).toBe(expectedDiagnostics[index]);
    });
  });
});
