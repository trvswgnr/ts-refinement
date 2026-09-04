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
  inlineCode(localName: string, runtimeSpecifier: string): string;
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\/]/gu, "\\$&");
}

function templateIndexGuard(
  segment: Extract<RefinementPathSegment, { readonly key: "template" }>,
  key: string,
  match: string,
  indent: string,
): readonly string[] {
  const source = segment.pattern.texts
    .map(
      (text, index) =>
        `${escapeRegExp(text)}${index < segment.pattern.placeholders.length ? "([\\s\\S]*?)" : ""}`,
    )
    .join("");
  const conditions = segment.pattern.placeholders.flatMap((placeholder, index) => {
    const capture = `${match}[${index + 1}]`;
    if (placeholder === "string") return [];
    if (placeholder === "number") {
      return [`${capture} !== "" && Number.isFinite(Number(${capture}))`];
    }
    return [`/^-?(?:0|[1-9]\\d*|0[xX][\\dA-Fa-f]+|0[oO][0-7]+|0[bB][01]+)$/.test(${capture})`];
  });
  return [
    `${indent}if (typeof ${key} !== "string") continue;`,
    `${indent}const ${match} = /^${source}$/u.exec(${key});`,
    `${indent}if (${match} === null${conditions.length === 0 ? "" : ` || !(${conditions.join(" && ")})`}) continue;`,
  ];
}

type TraversalLeaf = (subject: string, path: string, indent: string) => readonly string[];
type TraversalGuard = (
  subject: string,
  path: string,
  segment: RefinementPathSegment,
  indent: string,
) => readonly string[];

function emitTraversal(
  segments: readonly RefinementPathSegment[],
  namespace: string,
  rootSubject: string,
  rootPath: string,
  rootIndent: string,
  leaf: TraversalLeaf,
  guard: TraversalGuard = () => [],
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
    const guardLines = guard(subject, path, segment, indent);

    if (segment.kind === "union") {
      return [
        ...guardLines,
        `${indent}if (${subject}[${JSON.stringify(segment.property)}] === ${JSON.stringify(segment.value)}) {`,
        ...visit(subject, path, remaining, `${indent}  `),
        `${indent}}`,
      ];
    }

    const nested = `nested${namespace}_${variableIndex}`;
    variableIndex += 1;
    if (segment.kind === "property") {
      const nestedPath = `(${path} + ${JSON.stringify(propertyPathSegment(segment.name))})`;
      const lines = [
        ...guardLines,
        `${indent}const ${nested} = ${subject}[${JSON.stringify(segment.name)}];`,
      ];
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
      const lines = [...guardLines, `${indent}const ${nested} = ${subject}[${segment.index}];`];
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
      const match = `match${namespace}_${variableIndex}`;
      variableIndex += 1;
      const keyGuard =
        segment.key === "number"
          ? [
              `${indent}  if (typeof ${key} !== "string" || String(Number(${key})) !== ${key}) continue;`,
            ]
          : segment.key === "string"
            ? [`${indent}  if (typeof ${key} !== "string") continue;`]
            : segment.key === "symbol"
              ? [`${indent}  if (typeof ${key} !== "symbol") continue;`]
              : templateIndexGuard(segment, key, match, `${indent}  `);
      const pathSegment = `pathSegment${namespace}_${variableIndex}`;
      variableIndex += 1;
      const inheritedSymbols =
        segment.key === "symbol"
          ? [
              `${indent}for (let prototype${namespace}_${variableIndex} = Object.getPrototypeOf(${subject}); prototype${namespace}_${variableIndex} !== null; prototype${namespace}_${variableIndex} = Object.getPrototypeOf(prototype${namespace}_${variableIndex})) {`,
              `${indent}  for (const inheritedSymbol${namespace}_${variableIndex} of Object.getOwnPropertySymbols(prototype${namespace}_${variableIndex})) {`,
              `${indent}    if (Object.prototype.propertyIsEnumerable.call(prototype${namespace}_${variableIndex}, inheritedSymbol${namespace}_${variableIndex})) keys${namespace}_${variableIndex}.add(inheritedSymbol${namespace}_${variableIndex});`,
              `${indent}  }`,
              `${indent}}`,
            ]
          : [];
      return [
        ...guardLines,
        `${indent}const keys${namespace}_${variableIndex} = new Set(Reflect.ownKeys(${subject}));`,
        `${indent}for (const inherited${namespace}_${variableIndex} in ${subject}) keys${namespace}_${variableIndex}.add(inherited${namespace}_${variableIndex});`,
        ...inheritedSymbols,
        `${indent}for (const ${key} of keys${namespace}_${variableIndex}) {`,
        ...keyGuard,
        `${indent}  const ${nested} = ${subject}[${key}];`,
        `${indent}  const ${pathSegment} = typeof ${key} === "symbol" ? "[" + String(${key}) + "]" : /^[A-Za-z_$][\\w$]*$/.test(${key}) ? "." + ${key} : "[" + JSON.stringify(${key}) + "]";`,
        ...visit(nested, `(${path} + ${pathSegment})`, remaining, `${indent}  `),
        `${indent}}`,
      ];
    }

    const index = `index${namespace}_${variableIndex}`;
    variableIndex += 1;
    const start = segment.kind === "tupleRest" ? segment.start : 0;
    return [
      ...guardLines,
      `${indent}for (let ${index} = ${start}; ${index} < ${subject}.length; ${index} += 1) {`,
      `${indent}  const ${nested} = ${subject}[${index}];`,
      ...visit(nested, `(${path} + "[" + ${index} + "]")`, remaining, `${indent}  `),
      `${indent}}`,
    ];
  }

  return visit(rootSubject, rootPath, segments, rootIndent).join("\n");
}

function errorLines(
  check: RefinementCheck,
  subject: string,
  path: string,
  indent: string,
): readonly string[] {
  const predicateLabel = check.definition.predicates
    .map((predicate) => predicate.source)
    .join(" && ");
  const refinement =
    check.definition.displayName === undefined
      ? "refinement"
      : `refinement ?? ${JSON.stringify(check.definition.displayName)}`;
  return [
    `${indent}throw new RefinementError({`,
    `${indent}  path: ${path} || undefined,`,
    `${indent}  predicate: ${JSON.stringify(predicateLabel)},`,
    `${indent}  refinement: ${refinement},`,
    `${indent}  marker,`,
    `${indent}  value: ${subject},`,
    `${indent}});`,
  ];
}

function traversalGuard(check: RefinementCheck): TraversalGuard {
  return (subject, path, segment, indent) => {
    const requiresArray = ["array", "tuple", "tupleRest"].includes(segment.kind);
    const invalidArray = requiresArray ? ` || !Array.isArray(${subject})` : "";
    const invalidObject =
      segment.kind === "index"
        ? ` || (typeof ${subject} !== "object" && typeof ${subject} !== "function")`
        : "";
    return [
      `${indent}if (${subject} === null || ${subject} === undefined${invalidArray}${invalidObject}) {`,
      ...errorLines(check, subject, path, `${indent}  `),
      `${indent}}`,
    ];
  };
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
      return [
        `${indent}if (!(${condition})) {`,
        ...errorLines(check, subject, path, `${indent}  `),
        `${indent}}`,
      ];
    },
    traversalGuard(check),
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
            const guardCheck =
              checks.find((check) => relativePath(check.path, targetPath) !== null) ?? checks[0];
            return [
              emitTraversal(
                path,
                `${functionIndex}_r${recursionIndex}`,
                "subject",
                "path",
                "  ",
                (nested, nestedPath, indent) => [
                  `${indent}${targetFunction}(${nested}, ${nestedPath}, refinement, marker, seen);`,
                ],
                guardCheck === undefined ? undefined : traversalGuard(guardCheck),
              ),
            ];
          });
          return `function ${functionName}(subject, path, refinement, marker, seen) {
  if ((typeof subject === "object" && subject !== null) || typeof subject === "function") {
    if (seen[${functionIndex}].has(subject)) return;
    seen[${functionIndex}].add(subject);
  }
${[...emittedChecks, ...emittedRecursions].join("\n")}
}`;
        });
        validationCode = `${functions.join("\n\n")}

  const seen = Array.from({ length: ${targetPaths.size} }, () => new WeakSet());
  ${functionNames.get("[]")}(value, "", refinement, marker, seen);`;
      }
      const declarationEnd = recursions.length === 0 ? -1 : validationCode.lastIndexOf("\n\n  ");
      const declarations = declarationEnd === -1 ? "" : validationCode.slice(0, declarationEnd);
      const assertionCode =
        declarationEnd === -1 ? validationCode : validationCode.slice(declarationEnd + 2);
      const moduleCode = `import { RefinementError } from ${JSON.stringify(runtimeModule)};

${declarations}

export function assert(value, refinement, marker) {
${assertionCode}
  return value;
}
`;
      const entry: ValidatorEntry = {
        importId,
        inlineCode(localName, runtimeSpecifier) {
          return `const ${localName} = (() => {
  const { RefinementError } = require(${JSON.stringify(runtimeSpecifier)});
${declarations}
  return function assert(value, refinement, marker) {
${assertionCode}
    return value;
  };
})();`;
        },
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
