import type * as ts from "typescript";

import {
  compileExpression,
  type NormalizedPredicate,
  type RefinementCheck,
  type RefinementPathSegment,
  type RefinementRecursion,
} from "@ts-refinement/analyzer";

const publicValidatorPrefix = "ts-refinement-validator-";
const resolvedValidatorPrefix = `\0${publicValidatorPrefix}`;

export interface ValidatorEntry {
  readonly importId: string;
  readonly key: string;
  readonly localBaseName: string;
  readonly moduleCode: string;
  readonly resolvedId: string;
}

export interface ValidatorRegistry {
  clear(): void;
  getByResolvedId(id: string): ValidatorEntry | undefined;
  isPublicId(id: string): boolean;
  register(
    checks: readonly RefinementCheck[],
    recursions?: readonly RefinementRecursion[],
  ): ValidatorEntry;
  resolvePublicId(id: string): string;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function emitPredicate(
  tsModule: typeof ts,
  predicate: NormalizedPredicate,
  subject: string,
): string {
  return compileExpression(tsModule, predicate.expression, subject);
}

function propertyPathSegment(name: string): string {
  return /^[A-Za-z_$][\w$]*$/u.test(name) ? `.${name}` : `[${JSON.stringify(name)}]`;
}

type TraversalLeaf = (subject: string, path: string, indent: string) => readonly string[];

function emitTraversal(
  segments: readonly RefinementPathSegment[],
  namespace: string,
  rootSubject: string,
  rootPath: string,
  rootIndent: string,
  leaf: TraversalLeaf,
): string {
  let variableIndex = 0;

  function visit(
    subject: string,
    path: string,
    remainingSegments: readonly RefinementPathSegment[],
    indent: string,
  ): string[] {
    const [segment, ...remaining] = remainingSegments;
    if (segment === undefined) return [...leaf(subject, path, indent)];

    if (segment.kind === "union") {
      return [
        `${indent}if (${subject}[${JSON.stringify(segment.property)}] === ${JSON.stringify(segment.value)}) {`,
        ...visit(subject, path, remaining, `${indent}  `),
        `${indent}}`,
      ];
    }

    const nested = `nested${namespace}_${variableIndex}`;
    variableIndex += 1;
    if (segment.kind === "property") {
      const nestedPath = `(${path} + ${JSON.stringify(propertyPathSegment(segment.name))})`;
      const lines = [`${indent}const ${nested} = ${subject}[${JSON.stringify(segment.name)}];`];
      if (segment.optional) {
        lines.push(`${indent}if (${nested} !== undefined) {`);
        lines.push(...visit(nested, nestedPath, remaining, `${indent}  `));
        lines.push(`${indent}}`);
      } else {
        lines.push(...visit(nested, nestedPath, remaining, indent));
      }
      return lines;
    }

    if (segment.kind === "tuple") {
      const nestedPath = `(${path} + ${JSON.stringify(`[${segment.index}]`)})`;
      const lines = [`${indent}const ${nested} = ${subject}[${segment.index}];`];
      if (segment.optional) {
        lines.push(`${indent}if (${nested} !== undefined) {`);
        lines.push(...visit(nested, nestedPath, remaining, `${indent}  `));
        lines.push(`${indent}}`);
      } else {
        lines.push(...visit(nested, nestedPath, remaining, indent));
      }
      return lines;
    }

    if (segment.kind === "index") {
      const key = `key${namespace}_${variableIndex}`;
      variableIndex += 1;
      const keyGuard =
        segment.key === "number"
          ? `${indent}  if (!/^(?:0|[1-9]\\d*)$/.test(${key})) continue;`
          : null;
      const pathSegment = `pathSegment${namespace}_${variableIndex}`;
      variableIndex += 1;
      return [
        `${indent}for (const ${key} of Object.keys(${subject})) {`,
        ...(keyGuard === null ? [] : [keyGuard]),
        `${indent}  const ${nested} = ${subject}[${key}];`,
        `${indent}  const ${pathSegment} = /^[A-Za-z_$][\\w$]*$/.test(${key}) ? "." + ${key} : "[" + JSON.stringify(${key}) + "]";`,
        ...visit(nested, `(${path} + ${pathSegment})`, remaining, `${indent}  `),
        `${indent}}`,
      ];
    }

    const index = `index${namespace}_${variableIndex}`;
    variableIndex += 1;
    const start = segment.kind === "tupleRest" ? segment.start : 0;
    return [
      `${indent}for (let ${index} = ${start}; ${index} < ${subject}.length; ${index} += 1) {`,
      `${indent}  const ${nested} = ${subject}[${index}];`,
      ...visit(nested, `(${path} + "[" + ${index} + "]")`, remaining, `${indent}  `),
      `${indent}}`,
    ];
  }

  return visit(rootSubject, rootPath, segments, rootIndent).join("\n");
}

function emitCheck(
  tsModule: typeof ts,
  check: RefinementCheck,
  checkIndex: string,
  rootSubject = "value",
  rootPath = '""',
): string {
  return emitTraversal(
    check.path,
    checkIndex,
    rootSubject,
    rootPath,
    "  ",
    (subject, path, indent) => {
      const emittedPredicates = check.definition.predicates.map((predicate) =>
        emitPredicate(tsModule, predicate, subject),
      );
      const condition =
        emittedPredicates.map((predicate) => `(${predicate})`).join(" && ") || "true";
      const predicateLabel = check.definition.predicates
        .map((predicate) => predicate.source)
        .join(" && ");
      const refinement =
        check.definition.displayName === undefined
          ? "refinement"
          : `refinement ?? ${JSON.stringify(check.definition.displayName)}`;
      return [
        `${indent}if (!(${condition})) {`,
        `${indent}  throw new RefinementError({`,
        `${indent}    path: ${path} || undefined,`,
        `${indent}    predicate: ${JSON.stringify(predicateLabel)},`,
        `${indent}    refinement: ${refinement},`,
        `${indent}    marker,`,
        `${indent}    value: ${subject},`,
        `${indent}  });`,
        `${indent}}`,
      ];
    },
  );
}

function pathKey(path: readonly RefinementPathSegment[]): string {
  return JSON.stringify(path);
}

function relativePath(
  path: readonly RefinementPathSegment[],
  prefix: readonly RefinementPathSegment[],
): readonly RefinementPathSegment[] | null {
  if (path.length < prefix.length) return null;
  for (const [index, segment] of prefix.entries()) {
    if (JSON.stringify(path[index]) !== JSON.stringify(segment)) return null;
  }
  return path.slice(prefix.length);
}

export function createValidatorRegistry(
  tsModule: typeof ts,
  runtimeModule: string,
): ValidatorRegistry {
  const byKey = new Map<string, ValidatorEntry>();
  const byResolvedId = new Map<string, ValidatorEntry>();

  return {
    clear(): void {
      byKey.clear();
      byResolvedId.clear();
    },

    getByResolvedId(id: string): ValidatorEntry | undefined {
      return byResolvedId.get(id);
    },

    isPublicId(id: string): boolean {
      return id.startsWith(publicValidatorPrefix);
    },

    register(
      checks: readonly RefinementCheck[],
      recursions: readonly RefinementRecursion[] = [],
    ): ValidatorEntry {
      const semanticKey = JSON.stringify({
        checks: checks.map((check) => ({
          displayName: check.path.length === 0 ? undefined : check.definition.displayName,
          path: check.path,
          predicates: check.definition.predicates.map((predicate) => predicate.key),
        })),
        recursions,
        runtimeModule,
      });
      const existing = byKey.get(semanticKey);
      if (existing !== undefined) return existing;

      let suffix = stableHash(semanticKey);
      let importId = `${publicValidatorPrefix}${suffix}`;
      let resolvedId = `\0${importId}`;
      while (byResolvedId.has(resolvedId)) {
        suffix = `${suffix}_`;
        importId = `${publicValidatorPrefix}${suffix}`;
        resolvedId = `\0${importId}`;
      }

      let validationCode: string;
      if (recursions.length === 0) {
        validationCode = checks
          .map((check, index) => emitCheck(tsModule, check, String(index)))
          .join("\n");
      } else {
        const targetPaths = new Map<string, readonly RefinementPathSegment[]>();
        targetPaths.set("[]", []);
        for (const recursion of recursions) {
          targetPaths.set(pathKey(recursion.targetPath), recursion.targetPath);
        }
        const functionNames = new Map(
          [...targetPaths.keys()].map((key, index) => [key, `validate${index}`]),
        );
        const functions = [...targetPaths].map(([targetKey, targetPath], functionIndex) => {
          const functionName = functionNames.get(targetKey);
          if (functionName === undefined) throw new Error("Missing recursive validator function.");
          const emittedChecks = checks.flatMap((check, checkIndex) => {
            const path = relativePath(check.path, targetPath);
            return path === null
              ? []
              : [
                  emitCheck(
                    tsModule,
                    { ...check, path },
                    `${functionIndex}_${checkIndex}`,
                    "subject",
                    "path",
                  ),
                ];
          });
          const emittedRecursions = recursions.flatMap((recursion, recursionIndex) => {
            const path = relativePath(recursion.path, targetPath);
            const targetFunction = functionNames.get(pathKey(recursion.targetPath));
            if (path === null || targetFunction === undefined) return [];
            return [
              emitTraversal(
                path,
                `${functionIndex}_r${recursionIndex}`,
                "subject",
                "path",
                "  ",
                (nested, nestedPath, indent) => [
                  `${indent}${targetFunction}(${nested}, ${nestedPath}, refinement, marker);`,
                ],
              ),
            ];
          });
          return `function ${functionName}(subject, path, refinement, marker) {\n${[
            ...emittedChecks,
            ...emittedRecursions,
          ].join("\n")}\n}`;
        });
        validationCode = `${functions.join("\n\n")}\n\n  ${functionNames.get("[]")}(value, "", refinement, marker);`;
      }
      const moduleCode = `import { RefinementError } from ${JSON.stringify(runtimeModule)};

${recursions.length === 0 ? "" : validationCode.slice(0, validationCode.lastIndexOf("\n\n  "))}

export function assert(value, refinement, marker) {
${recursions.length === 0 ? validationCode : validationCode.slice(validationCode.lastIndexOf("\n\n  ") + 2)}
  return value;
}
`;
      const entry: ValidatorEntry = {
        importId,
        key: semanticKey,
        localBaseName: `__rf_${suffix}`,
        moduleCode,
        resolvedId,
      };
      byKey.set(semanticKey, entry);
      byResolvedId.set(resolvedId, entry);
      return entry;
    },

    resolvePublicId(id: string): string {
      return `${resolvedValidatorPrefix}${id.slice(publicValidatorPrefix.length)}`;
    },
  };
}
