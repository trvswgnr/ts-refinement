import MagicString, { type SourceMap } from "magic-string";
import type * as ts from "typescript";

import {
  analyzeSourceFile,
  getRefinementDefinitionDiagnostics,
  type AnalysisResult,
  type AnalyzerContext,
  type RefinementDiagnostic,
} from "../../analyzer/src/index.ts";
import type { ValidatorEntry, ValidatorRegistry } from "./validators.ts";

export interface TransformOutput {
  readonly code: string | null;
  readonly diagnostics: readonly RefinementDiagnostic[];
  readonly map: SourceMap | null;
}

function uniqueLocalName(
  source: string,
  entry: ValidatorEntry,
  allocatedNames: ReadonlySet<string>,
): string {
  let name = entry.localBaseName;
  while (allocatedNames.has(name) || new RegExp(`\\b${name}\\b`, "u").test(source)) {
    name = `${name}_`;
  }
  return name;
}

function importInsertionPoint(
  tsModule: typeof ts,
  sourceFile: ts.SourceFile,
  source: string,
): number {
  let position = source.startsWith("#!") ? source.indexOf("\n") + 1 || source.length : 0;

  for (const statement of sourceFile.statements) {
    if (
      !tsModule.isExpressionStatement(statement) ||
      !tsModule.isStringLiteral(statement.expression)
    ) {
      break;
    }
    const lineEnd = source.indexOf("\n", statement.getEnd());
    position = lineEnd === -1 ? source.length : lineEnd + 1;
  }

  return position;
}

function applyAssertionEdits(
  context: AnalyzerContext,
  source: string,
  analyses: readonly AnalysisResult[],
  registry: ValidatorRegistry,
  magicString: MagicString,
  imports: Map<ValidatorEntry, string>,
  allocatedNames: Set<string>,
): void {
  const prefixes = new Map<number, string[]>();
  const suffixes = new Map<number, string[]>();

  for (const analysis of analyses) {
    const node = analysis.site.node;
    if (context.ts.isAsExpression(node)) {
      magicString.remove(node.expression.getEnd(), node.getEnd());
    } else {
      magicString.remove(node.getStart(), node.expression.getStart());
    }

    if (analysis.proof.kind === "true") continue;
    const definition = analysis.site.definition;
    if (definition === null) continue;

    const entry = registry.register(definition);
    let localName = imports.get(entry);
    if (localName === undefined) {
      localName = uniqueLocalName(source, entry, allocatedNames);
      imports.set(entry, localName);
      allocatedNames.add(localName);
    }

    const expressionStart = node.expression.getStart();
    const expressionEnd = node.expression.getEnd();
    const atStart = prefixes.get(expressionStart) ?? [];
    atStart.push(`${localName}((`);
    prefixes.set(expressionStart, atStart);

    const refinementArgument =
      definition.displayName === undefined ? "" : `, ${JSON.stringify(definition.displayName)}`;
    const atEnd = suffixes.get(expressionEnd) ?? [];
    atEnd.unshift(`)${refinementArgument})`);
    suffixes.set(expressionEnd, atEnd);
  }

  for (const [start, atStart] of [...prefixes].sort(([left], [right]) => right - left)) {
    const codePoint = source.codePointAt(start);
    if (codePoint === undefined) throw new Error("Refinement expression has no source text.");
    const end = start + (codePoint > 0xffff ? 2 : 1);
    magicString.overwrite(start, end, `${atStart.join("")}${source.slice(start, end)}`);
  }

  for (const [end, atEnd] of suffixes) {
    magicString.appendLeft(end, atEnd.join(""));
  }
}

export function transformSource(
  context: AnalyzerContext,
  sourceFile: ts.SourceFile,
  source: string,
  registry: ValidatorRegistry,
): TransformOutput {
  if (sourceFile.text !== source) return { code: null, diagnostics: [], map: null };

  const analyses = analyzeSourceFile(context, sourceFile);
  const diagnostics = [
    ...getRefinementDefinitionDiagnostics(context, sourceFile),
    ...analyses.flatMap((analysis) => analysis.diagnostics),
  ];
  if (diagnostics.length > 0) return { code: null, diagnostics, map: null };

  const eligible = analyses.filter((analysis) => analysis.site.definition !== null);
  if (eligible.length === 0) return { code: null, diagnostics: [], map: null };

  const imports = new Map<ValidatorEntry, string>();
  const allocatedNames = new Set<string>();
  const magicString = new MagicString(source);
  applyAssertionEdits(context, source, eligible, registry, magicString, imports, allocatedNames);

  if (imports.size > 0) {
    const importCode = [...imports]
      .map(
        ([entry, localName]) =>
          `import { assert as ${localName} } from ${JSON.stringify(entry.importId)};`,
      )
      .join("\n");
    const insertionPoint = importInsertionPoint(context.ts, sourceFile, source);
    const leadingNewline = insertionPoint > 0 && source[insertionPoint - 1] !== "\n" ? "\n" : "";
    magicString.appendLeft(insertionPoint, `${leadingNewline}${importCode}\n`);
  }

  return {
    code: magicString.toString(),
    diagnostics: [],
    map: magicString.generateMap({
      file: sourceFile.fileName,
      hires: true,
      includeContent: true,
      source: sourceFile.fileName,
    }),
  };
}
