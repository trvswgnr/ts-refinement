export {
  analyzeAssertion,
  analyzeSourceFile,
  getRefinementDefinitionDiagnostics,
  getRefinementDiagnostics,
  type AnalysisResult,
  type RefinementSite,
} from "./analyze.ts";
export {
  refinementManifestSchemaVersion,
  refinementManifestFileName,
  refinementMarkerPrefix,
  refinementSiteMarker,
  type RefinementManifest,
  type RefinementManifestAsset,
  type RefinementManifestSite,
} from "./manifest.ts";
export {
  createDiagnostic,
  DiagnosticCode,
  formatDiagnosticCode,
  type RefinementDiagnostic,
  type RefinementDiagnosticSeverity,
} from "./diagnostics.ts";
export {
  evaluateExpression,
  evaluateSourceExpression,
  provePredicates,
  type Proof,
} from "./proof/evaluate.ts";
export { entails } from "./proof/entail.ts";
export { displayStaticValue, type StaticRuntimeValue, type StaticValue } from "./proof/values.ts";
export {
  compileExpression,
  findOpaqueExpression,
  foldFreeIdentifiers,
  serializeExpression,
  type NormalizedBinding,
  type NormalizedBindingElement,
  type NormalizedExpression,
  type NormalizedObjectBindingElement,
  type NormalizedPredicate,
} from "./predicate/ir.ts";
export { normalizePredicate } from "./predicate/normalize.ts";
export {
  emitPredicateWithSubject,
  parsePredicate,
  parsePredicateCandidates,
  type ParsedPredicate,
  type PredicateParseResult,
} from "./predicate/parse.ts";
export { analyzeFreeIdentifiers, type FreeIdentifierAnalysis } from "./predicate/scope.ts";
export { standardGlobals } from "./predicate/globals.ts";
export { filterEntailedRefinementDiagnostics } from "./refinement/filter-diagnostics.ts";
export { getPublishVerificationDiagnostics, hasConfiguredPublishVerification } from "./publish.ts";
export {
  resolveRefinement,
  resolveRefinementMetadata,
  resolvePredicateAtDeclaration,
  type AnalyzerContext,
  type PredicateResolution,
  type RefinementDefinition,
  type RefinementResolution,
  type RefinementResolutionIssue,
} from "./refinement/resolve.ts";
