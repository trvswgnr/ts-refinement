import { createHash } from "node:crypto";
import { constants, accessSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

import { parse, type AnyNode, type ObjectExpression } from "acorn";
import { ancestor } from "acorn-walk";
import * as v from "valibot";

import {
  refinementManifestSchemaVersion,
  refinementSiteMarker,
  type RefinementManifest,
} from "./manifest.ts";

const manifestSchema = v.strictObject({
  assets: v.array(
    v.strictObject({
      file: v.string(),
      sha256: v.string(),
    }),
  ),
  buildId: v.string(),
  project: v.strictObject({ configPath: v.string() }),
  schemaVersion: v.literal(refinementManifestSchemaVersion),
  sites: v.array(
    v.strictObject({
      id: v.string(),
      length: v.number(),
      module: v.string(),
      predicateKeys: v.array(v.string()),
      start: v.number(),
    }),
  ),
});

export function assertReadableOutputDirectory(directory: string): void {
  const statistics = statSync(directory);
  if (!statistics.isDirectory()) throw new Error(`Output path '${directory}' is not a directory.`);
  accessSync(directory, constants.R_OK);
}

type ManifestReadResult =
  | { readonly error: string; readonly ok: false }
  | { readonly manifest: RefinementManifest; readonly ok: true };

function readManifest(manifestPath: string): ManifestReadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    return { error: `Missing or unreadable refinement manifest '${manifestPath}'.`, ok: false };
  }
  const result = v.safeParse(manifestSchema, parsed);
  return result.success
    ? { manifest: result.output, ok: true }
    : {
        error: `Malformed or unsupported refinement manifest '${manifestPath}'.`,
        ok: false,
      };
}

type AssetPathResult =
  | { readonly error: "missing" | "outside"; readonly ok: false }
  | { readonly ok: true; readonly path: string };

function isOutside(directory: string, candidate: string): boolean {
  const relativeName = relative(directory, candidate);
  return relativeName === ".." || relativeName.startsWith(`..${sep}`) || isAbsolute(relativeName);
}

function containedAssetPath(directory: string, fileName: string): AssetPathResult {
  if (isAbsolute(fileName)) return { error: "outside", ok: false };
  const assetPath = resolve(directory, fileName);
  if (isOutside(directory, assetPath)) return { error: "outside", ok: false };
  try {
    const realDirectory = realpathSync(directory);
    const realAssetPath = realpathSync(assetPath);
    return isOutside(realDirectory, realAssetPath)
      ? { error: "outside", ok: false }
      : { ok: true, path: realAssetPath };
  } catch {
    return { error: "missing", ok: false };
  }
}

function javaScriptAssets(directory: string): readonly string[] {
  const files: string[] = [];
  function visit(currentDirectory: string): void {
    for (const entry of readdirSync(currentDirectory, { withFileTypes: true })) {
      const entryPath = resolve(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (
        (entry.isFile() || entry.isSymbolicLink()) &&
        [".cjs", ".js", ".mjs"].includes(extname(entry.name))
      ) {
        files.push(relative(directory, entryPath).replaceAll(sep, "/"));
      }
    }
  }
  visit(directory);
  return files.sort((left, right) => left.localeCompare(right));
}

type ParsedMarkerValue = RegExp | bigint | boolean | number | string | null | undefined;
type ParsedFunction = Extract<
  AnyNode,
  { readonly type: "ArrowFunctionExpression" | "FunctionDeclaration" | "FunctionExpression" }
>;
type ParsedProperty = Extract<AnyNode, { readonly type: "Property" }>;

function propertyName(property: ParsedProperty): string | null {
  if (!property.computed && property.key.type === "Identifier") return property.key.name;
  return property.key.type === "Literal" && v.is(v.string(), property.key.value)
    ? property.key.value
    : null;
}

function refinementErrorObject(ancestors: readonly AnyNode[]): ObjectExpression | null {
  const propertyIndex = ancestors.findLastIndex(
    (node) => node.type === "Property" && propertyName(node) === "marker",
  );
  const property = ancestors[propertyIndex];
  const object = ancestors[propertyIndex - 1];
  const construct = ancestors[propertyIndex - 2];
  const statement = ancestors[propertyIndex - 3];
  if (
    property?.type !== "Property" ||
    object?.type !== "ObjectExpression" ||
    construct?.type !== "NewExpression" ||
    !construct.arguments.includes(object) ||
    statement?.type !== "ThrowStatement" ||
    statement.argument !== construct
  ) {
    return null;
  }
  const names = new Set(
    object.properties.flatMap((candidate) =>
      candidate.type === "Property" ? [propertyName(candidate)] : [],
    ),
  );
  return ["marker", "path", "predicate", "refinement", "value"].every((name) => names.has(name))
    ? object
    : null;
}

function isFunctionNode(node: AnyNode): node is ParsedFunction {
  return (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression"
  );
}

function functionName(node: ParsedFunction, ancestors: readonly AnyNode[]): string | null {
  if (node.type === "FunctionDeclaration") return node.id?.name ?? null;
  const parent = ancestors[ancestors.indexOf(node) - 1];
  return parent?.type === "VariableDeclarator" && parent.id.type === "Identifier"
    ? parent.id.name
    : null;
}

interface ValidatorBindings {
  readonly farmImports: ReadonlyMap<ParsedFunction, ReadonlySet<string>>;
  readonly localNames: ReadonlySet<string>;
}

function enclosingFunction(ancestors: readonly AnyNode[]): ParsedFunction | null {
  return ancestors.findLast(isFunctionNode) ?? null;
}

function validatorBindings(program: AnyNode): ValidatorBindings {
  const localNames = new Set<string>();
  const moduleIds = new Set<string>();
  ancestor(program, {
    Property(property, _state, ancestors) {
      if (
        propertyName(property) !== "marker" ||
        property.value.type !== "Identifier" ||
        refinementErrorObject(ancestors) === null
      ) {
        return;
      }
      const functionNode = ancestors.findLast(isFunctionNode);
      const parameter = functionNode?.params.at(-1);
      const name = functionNode === undefined ? null : functionName(functionNode, ancestors);
      if (
        name !== null &&
        parameter?.type === "Identifier" &&
        parameter.name === property.value.name
      ) {
        localNames.add(name);
        const moduleProperty = ancestors.findLast(
          (node): node is ParsedProperty =>
            node.type === "Property" &&
            node.value.type === "FunctionExpression" &&
            node.value !== functionNode,
        );
        const moduleId = moduleProperty === undefined ? null : propertyName(moduleProperty);
        if (moduleId !== null) moduleIds.add(moduleId);
      }
    },
  });
  const farmImports = new Map<ParsedFunction, Set<string>>();
  ancestor(program, {
    VariableDeclarator(declaration, _state, ancestors) {
      if (
        declaration.id.type !== "Identifier" ||
        declaration.init?.type !== "CallExpression" ||
        declaration.init.arguments.length !== 1
      ) {
        return;
      }
      const moduleId = declaration.init.arguments[0];
      if (
        moduleId?.type !== "Literal" ||
        !v.is(v.string(), moduleId.value) ||
        !moduleIds.has(moduleId.value)
      ) {
        return;
      }
      const scope = enclosingFunction(ancestors);
      if (scope === null) return;
      const bindings = farmImports.get(scope) ?? new Set<string>();
      bindings.add(declaration.id.name);
      farmImports.set(scope, bindings);
    },
  });
  return { farmImports, localNames };
}

function isFarmValidatorImport(
  name: string,
  ancestors: readonly AnyNode[],
  bindings: ValidatorBindings,
): boolean {
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const scope = ancestors[index];
    if (
      scope !== undefined &&
      isFunctionNode(scope) &&
      bindings.farmImports.get(scope)?.has(name)
    ) {
      return true;
    }
  }
  return false;
}

function calledValidatorName(
  node: AnyNode,
  ancestors: readonly AnyNode[],
  bindings: ValidatorBindings,
): string | null {
  if (node.type === "Identifier" && bindings.localNames.has(node.name)) return node.name;
  if (node.type === "SequenceExpression") {
    const last = node.expressions.at(-1);
    return last === undefined ? null : calledValidatorName(last, ancestors, bindings);
  }
  if (
    node.type === "MemberExpression" &&
    node.object.type === "Identifier" &&
    !node.computed &&
    node.property.type === "Identifier" &&
    node.property.name === "assert" &&
    isFarmValidatorImport(node.object.name, ancestors, bindings)
  ) {
    return node.property.name;
  }
  return null;
}

function parseMarkers(fileName: string, source: string): Set<string> | null {
  const markers = new Set<string>();
  let bindings: ValidatorBindings;
  function recordMarker(
    value: ParsedMarkerValue,
    ancestors: readonly import("acorn").AnyNode[],
  ): void {
    if (!v.is(v.string(), value)) return;
    const node = ancestors.at(-1);
    const parent = ancestors.at(-2);
    if (node === undefined || parent === undefined) return;
    const validatorName =
      parent.type === "CallExpression"
        ? calledValidatorName(parent.callee, ancestors, bindings)
        : null;
    const assertionArgument =
      parent.type === "CallExpression" &&
      parent.arguments.at(-1) === node &&
      validatorName !== null &&
      (bindings.localNames.has(validatorName) || validatorName === "assert");
    const runtimeErrorMarker =
      parent.type === "Property" &&
      parent.value === node &&
      propertyName(parent) === "marker" &&
      refinementErrorObject(ancestors) !== null;
    if (assertionArgument || runtimeErrorMarker) markers.add(value);
  }
  try {
    const program = parse(source, {
      ecmaVersion: "latest",
      sourceFile: fileName,
      sourceType: "module",
    });
    bindings = validatorBindings(program);
    ancestor(program, {
      Literal(node, _state, ancestors) {
        recordMarker(node.value, ancestors);
      },
      TemplateLiteral(node, _state, ancestors) {
        const cooked = node.quasis[0]?.value.cooked;
        if (node.expressions.length === 0 && v.is(v.string(), cooked)) {
          recordMarker(cooked, ancestors);
        }
      },
    });
  } catch {
    return null;
  }
  return markers;
}

export function verifyOutput(directory: string, manifestPath: string): readonly string[] {
  const result = readManifest(manifestPath);
  if (!result.ok) return [result.error];
  const { manifest } = result;

  const failures: string[] = [];
  const manifestAssets = new Set(manifest.assets.map((asset) => asset.file.replaceAll("\\", "/")));
  for (const fileName of javaScriptAssets(directory)) {
    if (!manifestAssets.has(fileName)) {
      failures.push(`JavaScript asset '${fileName}' is not listed in the refinement manifest.`);
    }
  }
  const markers = new Set<string>();
  for (const asset of manifest.assets) {
    const assetPath = containedAssetPath(directory, asset.file);
    if (!assetPath.ok) {
      failures.push(
        assetPath.error === "outside"
          ? `Manifest asset '${asset.file}' is outside output directory '${directory}'.`
          : `Manifest asset '${asset.file}' is missing or unreadable.`,
      );
      continue;
    }

    let bytes: Buffer;
    try {
      bytes = readFileSync(assetPath.path);
    } catch {
      failures.push(`Manifest asset '${asset.file}' is missing or unreadable.`);
      continue;
    }
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== asset.sha256) {
      failures.push(`SHA-256 mismatch for manifest asset '${asset.file}'.`);
    }
    const assetMarkers = parseMarkers(asset.file, bytes.toString("utf8"));
    if (assetMarkers === null) {
      failures.push(`Emitted JavaScript asset '${asset.file}' is malformed.`);
    } else {
      for (const marker of assetMarkers) markers.add(marker);
    }
  }

  for (const site of manifest.sites) {
    if (markers.has(refinementSiteMarker(manifest.buildId, site.id))) continue;
    failures.push(
      `Missing runtime marker for '${site.module}' at ${site.start}:${site.length} (site ${site.id}).`,
    );
  }
  return failures;
}
