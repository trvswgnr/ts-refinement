import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import ts from "typescript/lib/tsserverlibrary";

import init from "../packages/typescript-plugin/src/index.ts";

import { fixtureDirectory, fixtureFile } from "./helpers.ts";

function createLanguageService(directory = fixtureDirectory): ts.LanguageService {
  const configPath = resolve(directory, "tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, directory);
  const versions = new Map(parsed.fileNames.map((fileName) => [fileName, "0"]));
  const host: ts.LanguageServiceHost = {
    fileExists: ts.sys.fileExists,
    getCompilationSettings: () => parsed.options,
    getCurrentDirectory: () => directory,
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
      90200, 90200, 90101, 90101, 90101,
    ]);
    expect(diagnostics[0]?.messageText).toContain("RF90200");

    const declarationDiagnostics = proxy
      .getSemanticDiagnostics(fixtureFile("types.ts"))
      .filter((diagnostic) => diagnostic.source === "ts-refinement");
    expect(declarationDiagnostics.map((diagnostic) => diagnostic.code)).toEqual([90000, 90002]);
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

  it("suppresses entailed refinements in every assignment position", () => {
    const languageService = createLanguageService();
    const getSemanticDiagnostics = languageService.getSemanticDiagnostics.bind(languageService);
    let originalDiagnostics: readonly ts.Diagnostic[] = [];
    languageService.getSemanticDiagnostics = (fileName) => {
      originalDiagnostics = getSemanticDiagnostics(fileName);
      return [...originalDiagnostics];
    };

    const plugin = init({ typescript: ts });
    // SAFETY: These are the complete language-service fields read by the plugin under test.
    const proxy = plugin.create({
      config: {},
      languageService,
      languageServiceHost: {},
      project: {},
      serverHost: ts.sys,
    } as ts.server.PluginCreateInfo);

    const diagnostics = proxy
      .getSemanticDiagnostics(fixtureFile("entailment-positions.ts"))
      .filter((diagnostic) => diagnostic.source !== "ts-refinement");

    expect(originalDiagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      2322, 2352, 2322, 2345, 2322, 2322, 2322, 2322, 2322, 2322,
    ]);
    expect(diagnostics).toEqual([]);
  });

  it("preserves publish verification warnings as warning diagnostics", () => {
    const directory = resolve(import.meta.dirname, "../fixtures/publish/unconfigured");
    const languageService = createLanguageService(directory);
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
      .getSemanticDiagnostics(resolve(directory, "index.ts"))
      .filter((diagnostic) => diagnostic.source === "ts-refinement");
    expect(diagnostics).toHaveLength(8);
    expect(diagnostics.every((diagnostic) => diagnostic.code === 90500)).toBe(true);
    expect(
      diagnostics.every((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Warning),
    ).toBe(true);
  });
});
