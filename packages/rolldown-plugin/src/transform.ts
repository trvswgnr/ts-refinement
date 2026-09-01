import MagicString, { SourceMap, type DecodedSourceMap, type SourceMapSegment } from "magic-string";
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

interface ValidatorMappingAnchor {
  readonly localName: string;
  readonly originalStart: number;
}

interface SourcePosition {
  readonly column: number;
  readonly line: number;
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
  mappingAnchors: ValidatorMappingAnchor[],
): void {
  const prefixes = new Map<number, string[]>();
  const suffixes = new Map<number, string[]>();

  for (const analysis of analyses) {
    const node = analysis.site.node;
    const isAsExpression = context.ts.isAsExpression(node);
    if (isAsExpression) {
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
    mappingAnchors.push({ localName, originalStart: node.getStart() });

    const expressionStart = isAsExpression ? node.expression.getStart() : node.getStart();
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
    magicString.appendLeft(start, atStart.join(""));
  }

  for (const [end, atEnd] of suffixes) {
    magicString.appendLeft(end, atEnd.join(""));
  }
}

function offsetPosition(source: string, offset: number): SourcePosition {
  const lineStart = source.lastIndexOf("\n", offset - 1) + 1;
  return {
    column: offset - lineStart,
    line: source.slice(0, lineStart).split("\n").length - 1,
  };
}

function addMappingSegment(
  decodedMap: DecodedSourceMap,
  generatedLine: number,
  segment: SourceMapSegment,
): void {
  const line = decodedMap.mappings[generatedLine] ?? [];
  decodedMap.mappings[generatedLine] = line;
  const index = line.findIndex((candidate) => candidate[0] >= segment[0]);
  if (index === -1) {
    line.push(segment);
  } else if (line[index]?.[0] === segment[0]) {
    line[index] = segment;
  } else {
    line.splice(index, 0, segment);
  }
}

function generateSourceMap(
  magicString: MagicString,
  code: string,
  source: string,
  fileName: string,
  mappingAnchors: readonly ValidatorMappingAnchor[],
): SourceMap {
  const decodedMap = magicString.generateDecodedMap({
    file: fileName,
    hires: true,
    includeContent: true,
    source: fileName,
  });
  let searchStart = 0;
  for (const anchor of mappingAnchors) {
    const marker = `${anchor.localName}((`;
    const generatedOffset = code.indexOf(marker, searchStart);
    if (generatedOffset === -1)
      throw new Error(`Unable to map validator call '${anchor.localName}'.`);
    searchStart = generatedOffset + marker.length;
    const generated = offsetPosition(code, generatedOffset);
    const original = offsetPosition(source, anchor.originalStart);
    addMappingSegment(decodedMap, generated.line, [
      generated.column,
      0,
      original.line,
      original.column,
    ]);
  }
  return new SourceMap(decodedMap);
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
  const mappingAnchors: ValidatorMappingAnchor[] = [];
  const magicString = new MagicString(source);
  applyAssertionEdits(
    context,
    source,
    eligible,
    registry,
    magicString,
    imports,
    allocatedNames,
    mappingAnchors,
  );

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

  const code = magicString.toString();
  return {
    code,
    diagnostics: [],
    map: generateSourceMap(magicString, code, source, sourceFile.fileName, mappingAnchors),
  };
}
