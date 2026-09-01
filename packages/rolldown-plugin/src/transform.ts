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

function isContainedBy(candidate: AnalysisResult, container: AnalysisResult): boolean {
  return (
    candidate.site.node.getStart() >= container.site.node.getStart() &&
    candidate.site.node.getEnd() <= container.site.node.getEnd()
  );
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

export function transformSource(
  context: AnalyzerContext,
  sourceFile: ts.SourceFile,
  source: string,
  registry: ValidatorRegistry,
): TransformOutput {
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

  function renderRange(start: number, end: number, candidates: readonly AnalysisResult[]): string {
    let rendered = source.slice(start, end);
    const contained = candidates.filter(
      (candidate) => candidate.site.node.getStart() >= start && candidate.site.node.getEnd() <= end,
    );
    const topLevel = contained.filter(
      (candidate) =>
        !contained.some(
          (possibleParent) =>
            possibleParent !== candidate && isContainedBy(candidate, possibleParent),
        ),
    );

    for (const analysis of [...topLevel].sort(
      (left, right) => right.site.node.getStart() - left.site.node.getStart(),
    )) {
      const replacement = renderAnalysis(analysis);
      const relativeStart = analysis.site.node.getStart() - start;
      const relativeEnd = analysis.site.node.getEnd() - start;
      rendered = `${rendered.slice(0, relativeStart)}${replacement}${rendered.slice(relativeEnd)}`;
    }
    return rendered;
  }

  function renderAnalysis(analysis: AnalysisResult): string {
    const node = analysis.site.node;
    const expression = renderRange(
      node.expression.getStart(),
      node.expression.getEnd(),
      eligible.filter((candidate) => candidate !== analysis),
    );
    if (analysis.proof.kind === "true") return expression;

    const definition = analysis.site.definition;
    if (definition === null) return expression;
    const entry = registry.register(definition);
    let localName = imports.get(entry);
    if (localName === undefined) {
      localName = uniqueLocalName(source, entry, allocatedNames);
      imports.set(entry, localName);
      allocatedNames.add(localName);
    }
    const refinementArgument =
      definition.displayName === undefined ? "" : `, ${JSON.stringify(definition.displayName)}`;
    return `${localName}((${expression})${refinementArgument})`;
  }

  const topLevel = eligible.filter(
    (candidate) =>
      !eligible.some(
        (possibleParent) =>
          possibleParent !== candidate && isContainedBy(candidate, possibleParent),
      ),
  );
  const magicString = new MagicString(source);
  for (const analysis of topLevel) {
    magicString.overwrite(
      analysis.site.node.getStart(),
      analysis.site.node.getEnd(),
      renderAnalysis(analysis),
    );
  }

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
