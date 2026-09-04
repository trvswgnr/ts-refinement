import type * as ts from "typescript";

import { entails } from "../proof/entail.ts";
import {
  resolveRefinementMetadata,
  type AnalyzerContext,
  type RefinementDefinition,
} from "./resolve.ts";

interface RefinementTransfer {
  readonly sourceExpression: ts.Expression;
  readonly targetType: ts.Type;
}

function hasExactSpan(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  start: number,
  length: number,
): boolean {
  return node.getStart(sourceFile) === start && node.getWidth(sourceFile) === length;
}

function declarationTransfer(
  context: AnalyzerContext,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  start: number,
  length: number,
): RefinementTransfer | null {
  if (
    !context.ts.isVariableDeclaration(node) &&
    !context.ts.isPropertyDeclaration(node) &&
    !context.ts.isParameter(node)
  ) {
    return null;
  }
  if (node.type === undefined || node.initializer === undefined) return null;
  if (!hasExactSpan(sourceFile, node.name, start, length)) return null;
  return {
    sourceExpression: node.initializer,
    targetType: context.checker.getTypeAtLocation(node.type),
  };
}

function containingFunction(
  context: AnalyzerContext,
  node: ts.Node,
): ts.SignatureDeclaration | undefined {
  let current = node.parent;
  while (current !== undefined) {
    if (context.ts.isFunctionLike(current)) return current;
    current = current.parent;
  }
  return undefined;
}

function returnType(
  context: AnalyzerContext,
  declaration: ts.SignatureDeclaration,
): ts.Type | undefined {
  if (declaration.type !== undefined) return context.checker.getTypeAtLocation(declaration.type);
  if (context.ts.isArrowFunction(declaration) || context.ts.isFunctionExpression(declaration)) {
    const contextual = context.checker.getContextualType(declaration);
    const signature =
      contextual === undefined
        ? undefined
        : context.checker.getSignaturesOfType(contextual, context.ts.SignatureKind.Call)[0];
    if (signature !== undefined) return context.checker.getReturnTypeOfSignature(signature);
  }
  const signature = context.checker.getSignatureFromDeclaration(declaration);
  return signature === undefined ? undefined : context.checker.getReturnTypeOfSignature(signature);
}

function parameterType(
  context: AnalyzerContext,
  call: ts.CallExpression | ts.NewExpression,
  argument: ts.Expression,
): ts.Type | undefined {
  const index = call.arguments?.indexOf(argument) ?? -1;
  if (index < 0) return undefined;
  const signature = context.checker.getResolvedSignature(call);
  const parameter = signature?.parameters[index] ?? signature?.parameters.at(-1);
  if (parameter === undefined) return undefined;
  const type = context.checker.getTypeOfSymbolAtLocation(parameter, argument);
  const declaration = parameter.valueDeclaration ?? parameter.declarations?.[0];
  if (
    declaration !== undefined &&
    context.ts.isParameter(declaration) &&
    declaration.dotDotDotToken !== undefined
  ) {
    return context.checker.getIndexTypeOfType(type, context.ts.IndexKind.Number);
  }
  return type;
}

function contextualType(context: AnalyzerContext, expression: ts.Expression): ts.Type | undefined {
  return context.checker.getContextualType(expression);
}

function binaryTransfers(
  context: AnalyzerContext,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  start: number,
  length: number,
): readonly RefinementTransfer[] {
  if (
    !context.ts.isBinaryExpression(node) ||
    node.operatorToken.kind !== context.ts.SyntaxKind.EqualsToken ||
    (!hasExactSpan(sourceFile, node, start, length) &&
      !hasExactSpan(sourceFile, node.left, start, length) &&
      !hasExactSpan(sourceFile, node.right, start, length))
  ) {
    return [];
  }
  return [
    {
      sourceExpression: node.right,
      targetType: context.checker.getTypeAtLocation(node.left),
    },
  ];
}

function returnTransfers(
  context: AnalyzerContext,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  start: number,
): readonly RefinementTransfer[] {
  if (
    !context.ts.isReturnStatement(node) ||
    node.expression === undefined ||
    node.getStart(sourceFile) !== start
  ) {
    return [];
  }
  const functionDeclaration = containingFunction(context, node);
  const targetType =
    functionDeclaration === undefined ? undefined : returnType(context, functionDeclaration);
  return targetType === undefined ? [] : [{ sourceExpression: node.expression, targetType }];
}

function arrayTransfers(
  context: AnalyzerContext,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  start: number,
  length: number,
): readonly RefinementTransfer[] {
  if (!context.ts.isArrayLiteralExpression(node)) return [];
  const transfers: RefinementTransfer[] = [];
  for (const element of node.elements) {
    if (!context.ts.isExpression(element) || !hasExactSpan(sourceFile, element, start, length)) {
      continue;
    }
    const targetType = contextualType(context, element);
    if (targetType !== undefined) transfers.push({ sourceExpression: element, targetType });
  }
  return transfers;
}

function propertyTransfers(
  context: AnalyzerContext,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  start: number,
  length: number,
): readonly RefinementTransfer[] {
  if (
    !context.ts.isPropertyAssignment(node) ||
    !hasExactSpan(sourceFile, node.name, start, length)
  ) {
    return [];
  }
  const targetType = contextualType(context, node.initializer);
  return targetType === undefined ? [] : [{ sourceExpression: node.initializer, targetType }];
}

function arrowTransfers(
  context: AnalyzerContext,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  start: number,
  length: number,
): readonly RefinementTransfer[] {
  if (
    !context.ts.isArrowFunction(node) ||
    !context.ts.isExpression(node.body) ||
    !hasExactSpan(sourceFile, node.body, start, length)
  ) {
    return [];
  }
  const targetType = returnType(context, node);
  return targetType === undefined ? [] : [{ sourceExpression: node.body, targetType }];
}

function assignmentTransfers(
  context: AnalyzerContext,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  start: number,
  length: number,
): readonly RefinementTransfer[] {
  const declaration = declarationTransfer(context, node, sourceFile, start, length);
  return [
    ...(declaration === null ? [] : [declaration]),
    ...binaryTransfers(context, node, sourceFile, start, length),
    ...returnTransfers(context, node, sourceFile, start),
    ...arrayTransfers(context, node, sourceFile, start, length),
    ...propertyTransfers(context, node, sourceFile, start, length),
    ...arrowTransfers(context, node, sourceFile, start, length),
  ];
}

function callTransfers(
  context: AnalyzerContext,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  start: number,
  length: number,
): readonly RefinementTransfer[] {
  if (!context.ts.isCallExpression(node) && !context.ts.isNewExpression(node)) return [];
  const transfers: RefinementTransfer[] = [];
  for (const argument of node.arguments ?? []) {
    if (!hasExactSpan(sourceFile, argument, start, length)) continue;
    const targetType = parameterType(context, node, argument);
    if (targetType !== undefined) transfers.push({ sourceExpression: argument, targetType });
  }
  return transfers;
}

function assertionTransfers(
  context: AnalyzerContext,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  start: number,
  length: number,
): readonly RefinementTransfer[] {
  if (
    (!context.ts.isAsExpression(node) && !context.ts.isTypeAssertionExpression(node)) ||
    !hasExactSpan(sourceFile, node, start, length)
  ) {
    return [];
  }
  return [
    {
      sourceExpression: node.expression,
      targetType: context.checker.getTypeAtLocation(node.type),
    },
  ];
}

function findTransfers(
  context: AnalyzerContext,
  sourceFile: ts.SourceFile,
  diagnostic: ts.Diagnostic,
): readonly RefinementTransfer[] {
  const start = diagnostic.start;
  const length = diagnostic.length;
  if (diagnostic.file !== sourceFile || start === undefined || length === undefined) return [];
  const diagnosticStart = start;
  const diagnosticLength = length;

  const transfers: RefinementTransfer[] = [];
  function visit(node: ts.Node): void {
    if (diagnostic.code === 2322) {
      transfers.push(
        ...assignmentTransfers(context, node, sourceFile, diagnosticStart, diagnosticLength),
      );
    }
    if (diagnostic.code === 2345) {
      transfers.push(
        ...callTransfers(context, node, sourceFile, diagnosticStart, diagnosticLength),
      );
    }
    if (diagnostic.code === 2352) {
      transfers.push(
        ...assertionTransfers(context, node, sourceFile, diagnosticStart, diagnosticLength),
      );
    }
    context.ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return transfers;
}

function basesAreAssignable(
  context: AnalyzerContext,
  source: RefinementDefinition,
  target: RefinementDefinition,
  typeIsEntailed: (sourceType: ts.Type, targetType: ts.Type) => boolean,
): boolean {
  return target.baseTypes.every((targetBase) =>
    source.baseTypes.some((sourceBase) => typeIsEntailed(sourceBase, targetBase)),
  );
}

function hasLengthBaseType(context: AnalyzerContext, definition: RefinementDefinition): boolean {
  return definition.baseTypes.some(
    (type) =>
      (type.flags & context.ts.TypeFlags.StringLike) !== 0 || context.checker.isArrayType(type),
  );
}

function propertyType(
  context: AnalyzerContext,
  type: ts.Type,
  name: string,
): { readonly symbol: ts.Symbol; readonly type: ts.Type } | null {
  const symbol = context.checker.getPropertyOfType(type, name);
  const location = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
  return symbol === undefined || location === undefined
    ? null
    : { symbol, type: context.checker.getTypeOfSymbolAtLocation(symbol, location) };
}

type EntailmentVisit = (source: ts.Type, target: ts.Type) => boolean;

function refinementTypeEntailment(
  context: AnalyzerContext,
  source: ts.Type,
  target: ts.Type,
  visit: EntailmentVisit,
): boolean | undefined {
  const sourceResolution = resolveRefinementMetadata(context, source);
  const targetResolution = resolveRefinementMetadata(context, target);
  if (targetResolution.isRefinement) {
    return (
      sourceResolution.isRefinement &&
      sourceResolution.definition !== null &&
      targetResolution.definition !== null &&
      basesAreAssignable(
        context,
        sourceResolution.definition,
        targetResolution.definition,
        visit,
      ) &&
      entails(sourceResolution.definition.predicates, targetResolution.definition.predicates, {
        subjectLength: hasLengthBaseType(context, targetResolution.definition),
      })
    );
  }
  if (!sourceResolution.isRefinement) return undefined;
  return (
    sourceResolution.definition !== null &&
    sourceResolution.definition.baseTypes.some((baseType) => visit(baseType, target))
  );
}

function unionEntailment(
  source: ts.Type,
  target: ts.Type,
  visit: EntailmentVisit,
): boolean | undefined {
  if (source.isUnion()) return source.types.every((part) => visit(part, target));
  if (target.isUnion()) return target.types.some((part) => visit(source, part));
  return undefined;
}

function typeParameterEntailment(
  context: AnalyzerContext,
  source: ts.Type,
  target: ts.Type,
  visit: EntailmentVisit,
): boolean | undefined {
  if ((source.flags & context.ts.TypeFlags.TypeParameter) !== 0) {
    const constraint = context.checker.getBaseConstraintOfType(source);
    return constraint !== undefined && visit(constraint, target);
  }
  if ((target.flags & context.ts.TypeFlags.TypeParameter) !== 0) {
    const constraint = context.checker.getBaseConstraintOfType(target);
    return constraint !== undefined && visit(source, constraint);
  }
  return undefined;
}

function arrayElementType(context: AnalyzerContext, type: ts.Type): ts.Type | undefined {
  if (!context.checker.isArrayType(type)) return undefined;
  return context.checker.getTypeArguments(type as ts.TypeReference)[0];
}

function isReadonlyArray(type: ts.Type): boolean {
  return type.getSymbol()?.getName() === "ReadonlyArray";
}

function tupleEntailment(
  context: AnalyzerContext,
  source: ts.Type,
  target: ts.Type,
  visit: EntailmentVisit,
): boolean | undefined {
  if (!context.checker.isTupleType(target)) return undefined;
  if (!context.checker.isTupleType(source)) return false;
  const sourceReference = tupleTypeReference(context, source);
  const targetReference = tupleTypeReference(context, target);
  const sourceTarget = sourceReference.target as ts.TupleType;
  const targetTarget = targetReference.target as ts.TupleType;
  if (sourceTarget.readonly && !targetTarget.readonly) return false;
  if (
    sourceTarget.elementFlags.length !== targetTarget.elementFlags.length ||
    sourceTarget.elementFlags.some((flags, index) => flags !== targetTarget.elementFlags[index])
  ) {
    return false;
  }
  const sourceElements = context.checker.getTypeArguments(sourceReference);
  const targetElements = context.checker.getTypeArguments(targetReference);
  return sourceElements.every((element, index) => {
    const targetElement = targetElements[index];
    return targetElement !== undefined && visit(element, targetElement);
  });
}

function arrayEntailment(
  context: AnalyzerContext,
  source: ts.Type,
  target: ts.Type,
  visit: EntailmentVisit,
): boolean | undefined {
  const targetElement = arrayElementType(context, target);
  if (targetElement === undefined) return undefined;
  if (isReadonlyArray(source) && !isReadonlyArray(target)) return false;
  if (context.checker.isTupleType(source)) {
    return context.checker
      .getTypeArguments(tupleTypeReference(context, source))
      .every((element) => visit(element, targetElement));
  }
  const sourceElement = arrayElementType(context, source);
  return sourceElement !== undefined && visit(sourceElement, targetElement);
}

function collectionEntailment(
  context: AnalyzerContext,
  source: ts.Type,
  target: ts.Type,
  visit: EntailmentVisit,
): boolean | undefined {
  return (
    tupleEntailment(context, source, target, visit) ??
    arrayEntailment(context, source, target, visit)
  );
}

function propertiesAreEntailed(
  context: AnalyzerContext,
  source: ts.Type,
  target: ts.Type,
  visit: EntailmentVisit,
): boolean {
  const targetProperties = context.checker
    .getPropertiesOfType(target)
    .filter((property) => !property.getName().startsWith("__@refinementBrand"));
  for (const targetProperty of targetProperties) {
    const sourceProperty = propertyType(context, source, targetProperty.getName());
    if (sourceProperty === null) {
      if ((targetProperty.flags & context.ts.SymbolFlags.Optional) !== 0) continue;
      return false;
    }
    if (
      (sourceProperty.symbol.flags & context.ts.SymbolFlags.Optional) !== 0 &&
      (targetProperty.flags & context.ts.SymbolFlags.Optional) === 0
    ) {
      return false;
    }
    const resolvedTargetProperty = propertyType(context, target, targetProperty.getName());
    if (
      resolvedTargetProperty === null ||
      !visit(sourceProperty.type, resolvedTargetProperty.type)
    ) {
      return false;
    }
  }
  return true;
}

function indexSignaturesAreEntailed(
  context: AnalyzerContext,
  source: ts.Type,
  target: ts.Type,
  visit: EntailmentVisit,
): boolean {
  for (const targetIndex of context.checker.getIndexInfosOfType(target)) {
    for (const property of context.checker.getPropertiesOfType(source)) {
      if (!propertyNameMatchesIndex(context, property.getName(), targetIndex.keyType)) continue;
      const sourceProperty = propertyType(context, source, property.getName());
      if (sourceProperty === null || !visit(sourceProperty.type, targetIndex.type)) {
        return false;
      }
    }
    for (const sourceIndex of context.checker.getIndexInfosOfType(source)) {
      if (
        indexTypesOverlap(context, sourceIndex.keyType, targetIndex.keyType) &&
        !visit(sourceIndex.type, targetIndex.type)
      ) {
        return false;
      }
    }
  }
  return true;
}

function indexTypesOverlap(context: AnalyzerContext, source: ts.Type, target: ts.Type): boolean {
  return (
    context.checker.isTypeAssignableTo(source, target) ||
    context.checker.isTypeAssignableTo(target, source) ||
    ((source.flags & context.ts.TypeFlags.String) !== 0 &&
      (target.flags & context.ts.TypeFlags.NumberLike) !== 0) ||
    ((target.flags & context.ts.TypeFlags.String) !== 0 &&
      (source.flags & context.ts.TypeFlags.NumberLike) !== 0)
  );
}

function propertyNameMatchesIndex(
  context: AnalyzerContext,
  name: string,
  keyType: ts.Type,
): boolean {
  if ((keyType.flags & context.ts.TypeFlags.ESSymbolLike) !== 0) {
    return name.startsWith("__@") || name.startsWith("\uFFFF");
  }
  if (name.startsWith("__@") || name.startsWith("\uFFFF")) return false;
  if ((keyType.flags & context.ts.TypeFlags.NumberLike) !== 0) {
    return String(Number(name)) === name;
  }
  if ((keyType.flags & context.ts.TypeFlags.TemplateLiteral) !== 0) {
    // SAFETY: TemplateLiteral flags are carried only by TemplateLiteralType values.
    const template = keyType as ts.TemplateLiteralType;
    const source = template.texts
      .map(
        (text, index) =>
          `${text.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&")}${index < template.types.length ? "([\\s\\S]*?)" : ""}`,
      )
      .join("");
    const captures = new RegExp(`^${source}$`, "u").exec(name)?.slice(1);
    return (
      captures !== undefined &&
      captures.every((capture, index) => {
        const placeholder = template.types[index];
        if (placeholder === undefined || (placeholder.flags & context.ts.TypeFlags.String) !== 0) {
          return true;
        }
        if ((placeholder.flags & context.ts.TypeFlags.Number) !== 0) {
          return capture !== "" && Number.isFinite(Number(capture));
        }
        return /^-?(?:0|[1-9]\d*|0[xX][\dA-Fa-f]+|0[oO][0-7]+|0[bB][01]+)$/u.test(capture);
      })
    );
  }
  return (keyType.flags & context.ts.TypeFlags.StringLike) !== 0;
}

function signaturesAreEntailed(
  context: AnalyzerContext,
  source: ts.Type,
  target: ts.Type,
  kind: ts.SignatureKind,
  visit: EntailmentVisit,
): boolean {
  const targetSignatures = context.checker.getSignaturesOfType(target, kind);
  if (targetSignatures.length === 0 || context.checker.isTypeAssignableTo(source, target)) {
    return true;
  }
  const sourceSignatures = context.checker.getSignaturesOfType(source, kind);
  return targetSignatures.every((targetSignature) =>
    sourceSignatures.some((sourceSignature) =>
      signatureIsEntailed(context, sourceSignature, targetSignature, visit),
    ),
  );
}

function signatureHasRestParameter(context: AnalyzerContext, signature: ts.Signature): boolean {
  const parameter = signature.declaration?.parameters.at(-1);
  return (
    parameter !== undefined &&
    context.ts.isParameter(parameter) &&
    parameter.dotDotDotToken !== undefined
  );
}

function signatureSymbolType(
  context: AnalyzerContext,
  signature: ts.Signature,
  parameter: ts.Symbol | undefined,
): ts.Type | null {
  const location =
    parameter?.valueDeclaration ?? parameter?.declarations?.[0] ?? signature.declaration;
  if (parameter === undefined || location === undefined) return null;
  return context.checker.getTypeOfSymbolAtLocation(parameter, location);
}

interface SignatureParameters {
  readonly fixed: readonly ts.Type[];
  readonly minimum: number;
  readonly rest: ts.Type | null;
}

interface TupleParameters {
  readonly minimum: number;
  readonly rest: ts.Type | null;
}

function tupleTypeReference(context: AnalyzerContext, type: ts.Type): ts.TypeReference {
  if (!context.checker.isTupleType(type)) throw new Error("Expected a tuple type.");
  // SAFETY: isTupleType establishes a TypeReference backed by a TupleType target.
  return type as ts.TypeReference;
}

function appendTupleParameters(
  context: AnalyzerContext,
  tuple: ts.TypeReference,
  fixed: ts.Type[],
): TupleParameters {
  const elements = context.checker.getTypeArguments(tuple);
  // SAFETY: tupleTypeReference is only called after isTupleType succeeds.
  const target = tuple.target as ts.TupleType & {
    readonly elementFlags?: readonly ts.ElementFlags[];
  };
  let minimum = 0;
  for (const [index, element] of elements.entries()) {
    const flags = target.elementFlags?.[index] ?? context.ts.ElementFlags.Required;
    if ((flags & (context.ts.ElementFlags.Rest | context.ts.ElementFlags.Variadic)) !== 0) {
      return { minimum, rest: element };
    }
    fixed.push(element);
    if ((flags & context.ts.ElementFlags.Required) !== 0) minimum = fixed.length;
  }
  return { minimum, rest: null };
}

function signatureParameters(
  context: AnalyzerContext,
  signature: ts.Signature,
): SignatureParameters | null {
  const parameters = signature.getParameters();
  const hasRest = signatureHasRestParameter(context, signature);
  const fixed: ts.Type[] = [];
  let minimum = 0;
  let rest: ts.Type | null = null;
  for (const [index, parameter] of parameters.entries()) {
    const resolvedParameter = signatureSymbolType(context, signature, parameter);
    if (resolvedParameter === null) return null;
    if (hasRest && index === parameters.length - 1) {
      if (context.checker.isTupleType(resolvedParameter)) {
        const tuple = appendTupleParameters(
          context,
          tupleTypeReference(context, resolvedParameter),
          fixed,
        );
        minimum = Math.max(minimum, tuple.minimum);
        rest = tuple.rest;
      } else {
        rest =
          context.checker.getIndexTypeOfType(resolvedParameter, context.ts.IndexKind.Number) ??
          null;
        if (rest === null) return null;
      }
      continue;
    }
    fixed.push(resolvedParameter);
    if ((parameter.flags & context.ts.SymbolFlags.Optional) === 0) minimum = fixed.length;
  }
  return { fixed, minimum, rest };
}

function parameterAt(parameters: SignatureParameters, index: number): ts.Type | null {
  return parameters.fixed[index] ?? (index >= parameters.fixed.length ? parameters.rest : null);
}

function signatureSupportsStructuralEntailment(
  context: AnalyzerContext,
  source: ts.Signature,
  target: ts.Signature,
): boolean {
  return (
    source.getTypeParameters() === undefined &&
    target.getTypeParameters() === undefined &&
    context.checker.getTypePredicateOfSignature(source) === undefined &&
    context.checker.getTypePredicateOfSignature(target) === undefined &&
    (source.thisParameter === undefined) === (target.thisParameter === undefined)
  );
}

function signatureThisIsEntailed(
  context: AnalyzerContext,
  source: ts.Signature,
  target: ts.Signature,
  visit: EntailmentVisit,
): boolean {
  if (source.thisParameter === undefined || target.thisParameter === undefined) return true;
  const sourceThis = signatureSymbolType(context, source, source.thisParameter);
  const targetThis = signatureSymbolType(context, target, target.thisParameter);
  return sourceThis !== null && targetThis !== null && visit(targetThis, sourceThis);
}

function signatureParametersAreEntailed(
  source: SignatureParameters,
  target: SignatureParameters,
  visit: EntailmentVisit,
): boolean {
  const fixedCount = Math.max(source.fixed.length, target.fixed.length);
  for (let index = 0; index < fixedCount; index += 1) {
    const sourceParameter = parameterAt(source, index);
    const targetParameter = parameterAt(target, index);
    if (
      sourceParameter !== null &&
      targetParameter !== null &&
      !visit(targetParameter, sourceParameter)
    ) {
      return false;
    }
  }
  return source.rest === null || target.rest === null || visit(target.rest, source.rest);
}

function signatureIsEntailed(
  context: AnalyzerContext,
  source: ts.Signature,
  target: ts.Signature,
  visit: EntailmentVisit,
): boolean {
  if (!signatureSupportsStructuralEntailment(context, source, target)) return false;

  const sourceParameters = signatureParameters(context, source);
  const targetParameters = signatureParameters(context, target);
  if (sourceParameters === null || targetParameters === null) return false;
  if (sourceParameters.minimum > targetParameters.minimum) return false;
  if (!signatureThisIsEntailed(context, source, target, visit)) return false;
  if (!signatureParametersAreEntailed(sourceParameters, targetParameters, visit)) return false;

  const targetReturn = target.getReturnType();
  return (
    (targetReturn.flags & context.ts.TypeFlags.Void) !== 0 ||
    visit(source.getReturnType(), targetReturn)
  );
}

interface RefinementPresence {
  readonly hasRefinement: boolean;
  readonly valid: boolean;
}

function combineRefinementPresence(parts: readonly RefinementPresence[]): RefinementPresence {
  return {
    hasRefinement: parts.some((part) => part.hasRefinement),
    valid: parts.every((part) => part.valid),
  };
}

function objectRefinementPresence(
  context: AnalyzerContext,
  type: ts.Type,
  visit: (type: ts.Type | undefined) => RefinementPresence,
): RefinementPresence {
  const nested: RefinementPresence[] = [];
  for (const kind of [context.ts.SignatureKind.Call, context.ts.SignatureKind.Construct]) {
    for (const signature of context.checker.getSignaturesOfType(type, kind)) {
      if (
        signature.getTypeParameters() !== undefined ||
        context.checker.getTypePredicateOfSignature(signature) !== undefined
      ) {
        continue;
      }
      nested.push(visit(signature.getReturnType()));
      nested.push(
        visit(signatureSymbolType(context, signature, signature.thisParameter) ?? undefined),
      );
      const parameters = signatureParameters(context, signature);
      if (parameters !== null) {
        nested.push(...parameters.fixed.map(visit));
        nested.push(visit(parameters.rest ?? undefined));
      }
    }
  }
  for (const property of context.checker.getPropertiesOfType(type)) {
    if (property.getName().startsWith("__@refinementBrand")) continue;
    nested.push(visit(propertyType(context, type, property.getName())?.type));
  }
  for (const index of context.checker.getIndexInfosOfType(type)) nested.push(visit(index.type));
  return combineRefinementPresence(nested);
}

function typeContainsRefinement(context: AnalyzerContext, root: ts.Type): RefinementPresence {
  const visited = new Set<ts.Type>();

  function visit(type: ts.Type | undefined): RefinementPresence {
    if (type === undefined || visited.has(type)) return { hasRefinement: false, valid: true };
    visited.add(type);

    const resolution = resolveRefinementMetadata(context, type);
    if (resolution.isRefinement) {
      return {
        hasRefinement: resolution.definition !== null,
        valid: resolution.definition !== null && resolution.issues.length === 0,
      };
    }
    if (type.isUnion()) return combineRefinementPresence(type.types.map(visit));
    if ((type.flags & context.ts.TypeFlags.TypeParameter) !== 0) {
      return visit(context.checker.getBaseConstraintOfType(type));
    }
    if (context.checker.isTupleType(type)) {
      return combineRefinementPresence(
        context.checker.getTypeArguments(tupleTypeReference(context, type)).map(visit),
      );
    }
    if (context.checker.isArrayType(type)) {
      return visit(context.checker.getIndexTypeOfType(type, context.ts.IndexKind.Number));
    }
    if ((type.flags & context.ts.TypeFlags.Object) === 0) {
      return { hasRefinement: false, valid: true };
    }

    return objectRefinementPresence(context, type, visit);
  }

  return visit(root);
}

function refinementStructureIsEntailed(
  context: AnalyzerContext,
  sourceType: ts.Type,
  targetType: ts.Type,
): boolean {
  const visited = new Map<ts.Type, Set<ts.Type>>();

  function visit(source: ts.Type, target: ts.Type): boolean {
    if (source === target) return true;
    const sourceTargets = visited.get(source) ?? new Set<ts.Type>();
    if (sourceTargets.has(target)) return true;
    sourceTargets.add(target);
    visited.set(source, sourceTargets);

    const unionResult = unionEntailment(source, target, visit);
    if (unionResult !== undefined) return unionResult;
    const refinementResult = refinementTypeEntailment(context, source, target, visit);
    if (refinementResult !== undefined) return refinementResult;
    const typeParameterResult = typeParameterEntailment(context, source, target, visit);
    if (typeParameterResult !== undefined) return typeParameterResult;
    const collectionResult = collectionEntailment(context, source, target, visit);
    if (collectionResult !== undefined) return collectionResult;

    if (
      (source.flags & context.ts.TypeFlags.Object) === 0 ||
      (target.flags & context.ts.TypeFlags.Object) === 0
    ) {
      return context.checker.isTypeAssignableTo(source, target);
    }

    return (
      propertiesAreEntailed(context, source, target, visit) &&
      indexSignaturesAreEntailed(context, source, target, visit) &&
      signaturesAreEntailed(context, source, target, context.ts.SignatureKind.Call, visit) &&
      signaturesAreEntailed(context, source, target, context.ts.SignatureKind.Construct, visit)
    );
  }

  return visit(sourceType, targetType);
}

function transferIsEntailed(context: AnalyzerContext, transfer: RefinementTransfer): boolean {
  const sourceType = context.checker.getTypeAtLocation(transfer.sourceExpression);
  const sourcePresence = typeContainsRefinement(context, sourceType);
  const targetPresence = typeContainsRefinement(context, transfer.targetType);
  if (
    !sourcePresence.valid ||
    !targetPresence.valid ||
    !sourcePresence.hasRefinement ||
    !targetPresence.hasRefinement
  ) {
    return false;
  }
  return refinementStructureIsEntailed(context, sourceType, transfer.targetType);
}

/**
 * Removes only TypeScript brand incompatibility diagnostics made redundant by a
 * proven refinement implication. All retained diagnostics are returned unchanged
 * and in their original order.
 */
export function filterEntailedRefinementDiagnostics(
  context: AnalyzerContext,
  sourceFile: ts.SourceFile,
  diagnostics: readonly ts.Diagnostic[],
): readonly ts.Diagnostic[] {
  return diagnostics.filter((diagnostic) => {
    if (diagnostic.code !== 2322 && diagnostic.code !== 2345 && diagnostic.code !== 2352) {
      return true;
    }
    const transfers = findTransfers(context, sourceFile, diagnostic);
    if (transfers.length !== 1) return true;
    const transfer = transfers[0];
    return transfer === undefined || !transferIsEntailed(context, transfer);
  });
}
