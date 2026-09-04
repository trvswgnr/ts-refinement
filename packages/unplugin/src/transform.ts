import MagicString, { SourceMap, type DecodedSourceMap, type SourceMapSegment } from "magic-string";
import type * as ts from "typescript";

import {
  analyzeSourceFile,
  getRefinementDefinitionDiagnostics,
  type AnalysisResult,
  type AnalyzerContext,
  type RefinementDiagnostic,
} from "@ts-refinement/analyzer";
import type { ValidatorEntry, ValidatorRegistry } from "./validators.ts";
import type { BuildTracker } from "./manifest.ts";

export interface TransformOutput {
  readonly code: string | null;
  readonly diagnostics: readonly RefinementDiagnostic[];
  readonly map: SourceMap | null;
}

export interface TransformSourceOptions {
  readonly commonJsRuntimeSpecifier?: string;
}

interface ValidatorMappingAnchor {
  readonly localName: string;
  readonly originalStart: number;
}

interface SourcePosition {
  readonly column: number;
  readonly line: number;
}

interface AssertionEditState {
  readonly allocatedNames: Set<string>;
  readonly context: AnalyzerContext;
  readonly imports: Map<ValidatorEntry, string>;
  readonly magicString: MagicString;
  readonly mappingAnchors: ValidatorMappingAnchor[];
  readonly prefixes: Map<number, string[]>;
  readonly registry: ValidatorRegistry;
  readonly source: string;
  readonly suffixes: Map<number, string[]>;
  readonly tracker: BuildTracker | undefined;
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

function applyAssertionEdit(state: AssertionEditState, analysis: AnalysisResult): void {
  const node = analysis.site.node;
  const isAsExpression = state.context.ts.isAsExpression(node);
  if (isAsExpression) {
    state.magicString.remove(node.expression.getEnd(), node.getEnd());
  } else {
    state.magicString.remove(node.getStart(), node.expression.getStart());
  }

  if (analysis.proof.kind === "true") return;
  const { checks, definition } = analysis.site;
  if (checks.length === 0) return;

  const entry = state.registry.register(checks, analysis.site.recursions);
  let localName = state.imports.get(entry);
  if (localName === undefined) {
    localName = uniqueLocalName(state.source, entry, state.allocatedNames);
    state.imports.set(entry, localName);
    state.allocatedNames.add(localName);
  }
  state.mappingAnchors.push({ localName, originalStart: node.getStart() });

  const expressionStart = isAsExpression ? node.expression.getStart() : node.getStart();
  const expressionEnd = node.expression.getEnd();
  const atStart = state.prefixes.get(expressionStart) ?? [];
  atStart.push(`${localName}((`);
  state.prefixes.set(expressionStart, atStart);

  const refinementArgument =
    definition?.displayName === undefined ? "" : `, ${JSON.stringify(definition.displayName)}`;
  const markerArgument =
    state.tracker === undefined
      ? ""
      : `${definition?.displayName === undefined ? ", undefined" : ""}, ${JSON.stringify(state.tracker.registerSite(analysis))}`;
  const atEnd = state.suffixes.get(expressionEnd) ?? [];
  atEnd.unshift(`)${refinementArgument}${markerArgument})`);
  state.suffixes.set(expressionEnd, atEnd);
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
  tracker: BuildTracker | undefined,
): void {
  const prefixes = new Map<number, string[]>();
  const suffixes = new Map<number, string[]>();
  const state = {
    allocatedNames,
    context,
    imports,
    magicString,
    mappingAnchors,
    prefixes,
    registry,
    source,
    suffixes,
    tracker,
  };

  for (const analysis of analyses) {
    applyAssertionEdit(state, analysis);
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
  tracker?: BuildTracker,
  options: TransformSourceOptions = {},
): TransformOutput {
  if (sourceFile.text !== source) {
    throw new Error(`Source text invariant failed for '${sourceFile.fileName}'.`);
  }

  const analyses = analyzeSourceFile(context, sourceFile);
  const diagnostics = [
    ...getRefinementDefinitionDiagnostics(context, sourceFile),
    ...analyses.flatMap((analysis) => analysis.diagnostics),
  ];
  if (diagnostics.length > 0) return { code: null, diagnostics, map: null };

  const eligible = analyses.filter((analysis) => analysis.site.checks.length > 0);
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
    tracker,
  );

  if (imports.size > 0) {
    const importCode = [...imports]
      .map(([entry, localName]) =>
        options.commonJsRuntimeSpecifier === undefined
          ? `import { assert as ${localName} } from ${JSON.stringify(entry.importId)};`
          : entry.inlineCode(localName, options.commonJsRuntimeSpecifier),
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
