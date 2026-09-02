import { basename, dirname, join, resolve } from "node:path";

import type * as ts from "typescript";

import {
  createDiagnostic,
  DiagnosticCode,
  type DiagnosticLocation,
  type RefinementDiagnostic,
} from "./diagnostics.ts";
import type { AnalyzerContext } from "./refinement/resolve.ts";

interface PackageVerification {
  readonly configured: boolean;
  readonly name: string | null;
  readonly packagePath: string;
  readonly private: boolean;
}

type ShellOperator = "&" | "&&" | ";" | "|" | "||";

interface ShellCommand {
  readonly preceding: ShellOperator | null;
  readonly words: readonly string[];
}

function shellOperator(character: ";" | "&" | "|", repeated: boolean): ShellOperator {
  if (character === ";") return ";";
  if (character === "&") return repeated ? "&&" : "&";
  return repeated ? "||" : "|";
}

function propertyName(tsModule: typeof ts, property: ts.ObjectLiteralElementLike): string | null {
  if (!tsModule.isPropertyAssignment(property)) return null;
  const { name } = property;
  return tsModule.isIdentifier(name) || tsModule.isStringLiteral(name) ? name.text : null;
}

function propertyValue(
  tsModule: typeof ts,
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | null {
  for (let index = object.properties.length - 1; index >= 0; index -= 1) {
    const property = object.properties[index];
    if (
      property !== undefined &&
      tsModule.isPropertyAssignment(property) &&
      propertyName(tsModule, property) === name
    ) {
      return property.initializer;
    }
  }
  return null;
}

function packageObject(
  tsModule: typeof ts,
  packagePath: string,
): ts.ObjectLiteralExpression | null {
  const source = tsModule.sys.readFile(packagePath);
  if (source === undefined) return null;
  const sourceFile = tsModule.parseJsonText(packagePath, source);
  const statement = sourceFile.statements[0];
  return statement !== undefined &&
    tsModule.isExpressionStatement(statement) &&
    tsModule.isObjectLiteralExpression(statement.expression)
    ? statement.expression
    : null;
}

function stringProperty(
  tsModule: typeof ts,
  object: ts.ObjectLiteralExpression,
  name: string,
): string | null {
  const value = propertyValue(tsModule, object, name);
  return value !== null && tsModule.isStringLiteral(value) ? value.text : null;
}

function shellCommands(source: string): readonly ShellCommand[] {
  const commands: ShellCommand[] = [];
  let words: string[] = [];
  let preceding: ShellOperator | null = null;
  let quote: "double" | "single" | null = null;
  let token = "";
  let escaped = false;

  function flushToken(): void {
    if (token.length === 0) return;
    words.push(token);
    token = "";
  }

  function flushCommand(nextOperator: ShellOperator | null): void {
    flushToken();
    if (words.length > 0) {
      commands.push({ preceding, words });
      words = [];
    }
    preceding = nextOperator;
  }

  function consumeQuoted(character: string): boolean {
    if (quote === null) return false;
    if ((quote === "single" && character === "'") || (quote === "double" && character === '"')) {
      quote = null;
    } else if (quote === "double" && character === "\\") {
      escaped = true;
    } else {
      token += character;
    }
    return true;
  }

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === undefined) continue;
    if (escaped) {
      token += character;
      escaped = false;
      continue;
    }
    if (consumeQuoted(character)) continue;
    if (character === "'") {
      quote = "single";
    } else if (character === '"') {
      quote = "double";
    } else if (character === "\\") {
      escaped = true;
    } else if (/\s/u.test(character)) {
      flushToken();
    } else if (character === ";" || character === "|" || character === "&") {
      const next = source[index + 1];
      const repeated = next === character;
      flushCommand(shellOperator(character, repeated));
      if (repeated) index += 1;
    } else {
      token += character;
    }
  }
  flushCommand(null);
  return commands;
}

function commandAlwaysFails(command: ShellCommand): boolean {
  if (command.words[0] === "false") return true;
  if (command.words[0] !== "exit") return false;
  const code = Number(command.words[1] ?? 0);
  return Number.isFinite(code) && code !== 0;
}

function commandIsReachable(commands: readonly ShellCommand[], index: number): boolean {
  for (let position = index; position > 0; position -= 1) {
    const preceding = commands[position]?.preceding;
    if (preceding === ";" || preceding === null) return true;
    if (preceding !== "&&") return false;
    const previous = commands[position - 1];
    if (previous !== undefined && commandAlwaysFails(previous)) return false;
  }
  return true;
}

function hasDirectVerifyCommand(packagePath: string, prepack: string, outDir: string): boolean {
  const packageDirectory = dirname(packagePath);
  const configuredDirectory = resolve(packageDirectory, outDir);
  const commands = shellCommands(prepack);
  return commands.some((command, index) => {
    const executable = command.words[0];
    const output = command.words[2];
    const direct =
      executable !== undefined &&
      basename(executable) === "ts-refinement" &&
      command.words[1] === "verify" &&
      output !== undefined &&
      resolve(packageDirectory, output) === configuredDirectory;
    if (!direct || !commandIsReachable(commands, index)) return false;
    return commands.slice(index + 1).every((following) => following.preceding === "&&");
  });
}

function readPackageVerification(
  tsModule: typeof ts,
  packagePath: string,
): PackageVerification | null {
  const object = packageObject(tsModule, packagePath);
  if (object === null) return null;
  const privateValue = propertyValue(tsModule, object, "private");
  const isPrivate = privateValue?.kind === tsModule.SyntaxKind.TrueKeyword;
  const scripts = propertyValue(tsModule, object, "scripts");
  const refinement = propertyValue(tsModule, object, "ts-refinement");
  const verify =
    refinement !== null && tsModule.isObjectLiteralExpression(refinement)
      ? propertyValue(tsModule, refinement, "verify")
      : null;
  const outDir =
    verify !== null && tsModule.isObjectLiteralExpression(verify)
      ? stringProperty(tsModule, verify, "outDir")
      : null;
  const prepack =
    scripts !== null && tsModule.isObjectLiteralExpression(scripts)
      ? stringProperty(tsModule, scripts, "prepack")
      : null;
  return {
    configured:
      outDir !== null && prepack !== null && hasDirectVerifyCommand(packagePath, prepack, outDir),
    name: stringProperty(tsModule, object, "name"),
    packagePath,
    private: isPrivate,
  };
}

export function hasConfiguredPublishVerification(
  tsModule: typeof ts,
  packagePath: string,
): boolean {
  const verification = readPackageVerification(tsModule, packagePath);
  return verification !== null && !verification.private && verification.configured;
}

function nearestPackage(context: AnalyzerContext, fileName: string): PackageVerification | null {
  let directory = dirname(resolve(fileName));
  for (;;) {
    const packagePath = join(directory, "package.json");
    if (context.ts.sys.fileExists(packagePath)) {
      return readPackageVerification(context.ts, packagePath);
    }
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

function isCanonicalRefinementMarker(context: AnalyzerContext, symbol: ts.Symbol): boolean {
  return (symbol.declarations ?? []).some((declaration) => {
    if (!context.ts.isPropertySignature(declaration) || declaration.name === undefined) {
      return false;
    }
    if (!context.ts.isComputedPropertyName(declaration.name)) return false;
    const expression = declaration.name.expression;
    if (!context.ts.isIdentifier(expression) || expression.text !== "refinementBrand") return false;
    let ancestor: ts.Node | undefined = declaration.parent;
    while (ancestor !== undefined) {
      if (context.ts.isTypeAliasDeclaration(ancestor)) {
        const owner = nearestPackage(context, declaration.getSourceFile().fileName);
        return ancestor.name.text === "Refined" && owner?.name === "ts-refinement";
      }
      ancestor = ancestor.parent;
    }
    return false;
  });
}

function typeArguments(context: AnalyzerContext, type: ts.Type): readonly ts.Type[] {
  const typeArgumentList = [...(type.aliasTypeArguments ?? [])];
  if ((type.flags & context.ts.TypeFlags.Object) === 0) return typeArgumentList;
  // SAFETY: TypeFlags.Object establishes the ObjectType representation used for objectFlags.
  const objectType = type as ts.ObjectType;
  if ((objectType.objectFlags & context.ts.ObjectFlags.Reference) === 0) return typeArgumentList;
  // SAFETY: ObjectFlags.Reference establishes the TypeReference representation.
  typeArgumentList.push(...context.checker.getTypeArguments(objectType as ts.TypeReference));
  return typeArgumentList;
}

type NestedTypeCheck = (type: ts.Type) => boolean;

function signaturesContainRefinement(
  context: AnalyzerContext,
  type: ts.Type,
  containsNested: NestedTypeCheck,
): boolean {
  for (const signature of [...type.getCallSignatures(), ...type.getConstructSignatures()]) {
    if (containsNested(signature.getReturnType())) return true;
    for (const parameter of signature.parameters) {
      const declaration = parameter.valueDeclaration ?? parameter.declarations?.[0];
      if (
        declaration !== undefined &&
        containsNested(context.checker.getTypeOfSymbolAtLocation(parameter, declaration))
      ) {
        return true;
      }
    }
  }
  return false;
}

function propertiesContainRefinement(
  context: AnalyzerContext,
  type: ts.Type,
  containsNested: NestedTypeCheck,
): boolean {
  for (const property of context.checker.getPropertiesOfType(type)) {
    const declaration = property.valueDeclaration ?? property.declarations?.[0];
    if (
      declaration !== undefined &&
      !declaration.getSourceFile().isDeclarationFile &&
      containsNested(context.checker.getTypeOfSymbolAtLocation(property, declaration))
    ) {
      return true;
    }
  }
  return false;
}

function containsRefinement(
  context: AnalyzerContext,
  type: ts.Type,
  seen: Set<ts.Type>,
  depth = 0,
): boolean {
  if (depth > 24 || seen.has(type)) return false;
  seen.add(type);
  const containsNested = (nested: ts.Type) => containsRefinement(context, nested, seen, depth + 1);
  if (
    context.checker
      .getPropertiesOfType(type)
      .some((symbol) => isCanonicalRefinementMarker(context, symbol))
  ) {
    return true;
  }
  if ((type.isIntersection() || type.isUnion()) && type.types.some(containsNested)) {
    return true;
  }
  if ((type.flags & context.ts.TypeFlags.TypeParameter) !== 0) {
    const constraint = context.checker.getBaseConstraintOfType(type);
    if (constraint !== undefined && containsNested(constraint)) return true;
  }
  if (typeArguments(context, type).some(containsNested)) {
    return true;
  }
  return (
    signaturesContainRefinement(context, type, containsNested) ||
    propertiesContainRefinement(context, type, containsNested)
  );
}

function symbolTarget(context: AnalyzerContext, symbol: ts.Symbol): ts.Symbol {
  return (symbol.flags & context.ts.SymbolFlags.Alias) === 0
    ? symbol
    : context.checker.getAliasedSymbol(symbol);
}

function exportDeclaration(
  context: AnalyzerContext,
  sourceFile: ts.SourceFile,
  symbol: ts.Symbol,
): ts.Declaration | null {
  const direct = (symbol.declarations ?? []).find(
    (declaration) => declaration.getSourceFile() === sourceFile,
  );
  if (direct !== undefined) return direct;

  const target = symbolTarget(context, symbol);
  for (const statement of sourceFile.statements) {
    if (
      !context.ts.isExportDeclaration(statement) ||
      statement.exportClause !== undefined ||
      statement.moduleSpecifier === undefined
    ) {
      continue;
    }
    const moduleSymbol = context.checker.getSymbolAtLocation(statement.moduleSpecifier);
    if (
      moduleSymbol !== undefined &&
      context.checker
        .getExportsOfModule(moduleSymbol)
        .some((candidate) => symbolTarget(context, candidate) === target)
    ) {
      return statement;
    }
  }
  return null;
}

function exportType(
  context: AnalyzerContext,
  symbol: ts.Symbol,
  declaration: ts.Declaration,
): ts.Type {
  const target = symbolTarget(context, symbol);
  return (target.flags & context.ts.SymbolFlags.Type) !== 0
    ? context.checker.getDeclaredTypeOfSymbol(target)
    : context.checker.getTypeOfSymbolAtLocation(target, declaration);
}

function declarationLocation(declaration: ts.Declaration): DiagnosticLocation {
  // SAFETY: TypeScript declaration variants expose an optional name node; unnamed variants fall back.
  const named = declaration as ts.Declaration & { readonly name?: ts.Node };
  const node = named.name ?? declaration;
  return { length: node.getWidth(), start: node.getStart() };
}

export function getPublishVerificationDiagnostics(
  context: AnalyzerContext,
  sourceFile: ts.SourceFile,
): readonly RefinementDiagnostic[] {
  if (sourceFile.isDeclarationFile || sourceFile.fileName.includes("/node_modules/")) return [];
  const packageVerification = nearestPackage(context, sourceFile.fileName);
  if (
    packageVerification === null ||
    packageVerification.private ||
    packageVerification.configured
  ) {
    return [];
  }
  const moduleSymbol = context.checker.getSymbolAtLocation(sourceFile);
  if (moduleSymbol === undefined) return [];

  const diagnostics: RefinementDiagnostic[] = [];
  const seen = new Set<number>();
  for (const symbol of context.checker.getExportsOfModule(moduleSymbol)) {
    const declaration = exportDeclaration(context, sourceFile, symbol);
    if (declaration === null || seen.has(declaration.getStart())) continue;
    if (!containsRefinement(context, exportType(context, symbol, declaration), new Set())) continue;
    seen.add(declaration.getStart());
    diagnostics.push(
      createDiagnostic(
        DiagnosticCode.PublishVerificationMissing,
        `Exported declaration '${symbol.getName()}' exposes refinement types without configured publish verification in '${packageVerification.packagePath}'.`,
        declarationLocation(declaration),
        "warning",
      ),
    );
  }
  return diagnostics;
}
