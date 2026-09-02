import type * as ts from "typescript";

import {
  compileExpression,
  type NormalizedPredicate,
  type RefinementDefinition,
} from "../../analyzer/src/index.ts";

const publicValidatorPrefix = "refinement-types:validator:";
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
  register(definition: RefinementDefinition): ValidatorEntry;
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

function emitPredicate(tsModule: typeof ts, predicate: NormalizedPredicate): string {
  return compileExpression(tsModule, predicate.expression, "value");
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

    register(definition: RefinementDefinition): ValidatorEntry {
      const semanticKey = JSON.stringify({
        predicates: definition.predicates.map((predicate) => predicate.key),
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

      const emittedPredicates = definition.predicates.map((predicate) =>
        emitPredicate(tsModule, predicate),
      );
      const condition =
        emittedPredicates.map((predicate) => `(${predicate})`).join(" && ") || "true";
      const predicateLabel = definition.predicates
        .map((predicate) => predicate.source)
        .join(" && ");
      const moduleCode = `import { RefinementError } from ${JSON.stringify(runtimeModule)};

export function assert(value, refinement) {
  if (!(${condition})) {
    throw new RefinementError({
      predicate: ${JSON.stringify(predicateLabel)},
      refinement,
      value,
    });
  }
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
