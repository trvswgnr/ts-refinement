package host

import (
	"strings"

	shimast "github.com/microsoft/typescript-go/shim/ast"
	shimchecker "github.com/microsoft/typescript-go/shim/checker"

	"github.com/ts-refinement/ttsc-plugin/native/analysis"
	"github.com/ts-refinement/ttsc-plugin/native/entailment"
)

func containsRefinement(checker *shimchecker.Checker, root *shimchecker.Type) (bool, bool) {
	visited := map[*shimchecker.Type]struct{}{}
	var visit func(*shimchecker.Type) (bool, bool)
	visit = func(target *shimchecker.Type) (bool, bool) {
		if target == nil {
			return false, true
		}
		if _, exists := visited[target]; exists {
			return false, true
		}
		visited[target] = struct{}{}
		resolution := analysis.Resolve(checker, target)
		if resolution.Refinement {
			return resolution.Definition != nil, len(resolution.Issues) == 0 && resolution.Definition != nil
		}
		if target.Flags()&shimchecker.TypeFlagsUnion != 0 {
			for _, part := range target.Types() {
				has, valid := visit(part)
				if !valid || has {
					return has, valid
				}
			}
		}
		if target.Flags()&shimchecker.TypeFlagsTypeParameter != 0 {
			return visit(checker.GetBaseConstraintOfType(target))
		}
		if target.Flags()&shimchecker.TypeFlagsObject == 0 {
			return false, true
		}
		for _, signature := range shimchecker.Checker_getSignaturesOfType(checker, target, shimchecker.SignatureKindCall) {
			has, valid := visit(shimchecker.Checker_getReturnTypeOfSignature(checker, signature))
			if !valid || has {
				return has, valid
			}
			has, valid = visit(signatureSymbolType(checker, signature.ThisParameter()))
			if !valid || has {
				return has, valid
			}
			for index := range shimchecker.Signature_parameterCount(signature) {
				has, valid = visit(signatureParameterType(checker, signature, index))
				if !valid || has {
					return has, valid
				}
			}
		}
		for _, index := range shimchecker.Checker_getIndexInfosOfType(checker, target) {
			has, valid := visit(index.ValueType())
			if !valid || has {
				return has, valid
			}
		}
		for _, property := range shimchecker.Checker_getPropertiesOfType(checker, target) {
			if property == nil || isRefinementBrand(property.Name) {
				continue
			}
			has, valid := visit(shimchecker.Checker_getTypeOfPropertyOfType(checker, target, property.Name))
			if !valid || has {
				return has, valid
			}
		}
		return false, true
	}
	return visit(root)
}

func refinementStructureIsEntailed(checker *shimchecker.Checker, sourceType, targetType *shimchecker.Type) bool {
	visited := map[*shimchecker.Type]map[*shimchecker.Type]struct{}{}
	var visit func(*shimchecker.Type, *shimchecker.Type) bool
	visit = func(source, target *shimchecker.Type) bool {
		if source == nil || target == nil {
			return false
		}
		if source == target {
			return true
		}
		targets := visited[source]
		if targets == nil {
			targets = map[*shimchecker.Type]struct{}{}
			visited[source] = targets
		}
		if _, exists := targets[target]; exists {
			return true
		}
		targets[target] = struct{}{}

		sourceResolution := analysis.Resolve(checker, source)
		targetResolution := analysis.Resolve(checker, target)
		if targetResolution.Refinement {
			if !sourceResolution.Refinement || sourceResolution.Definition == nil || targetResolution.Definition == nil ||
				len(sourceResolution.Issues) > 0 || len(targetResolution.Issues) > 0 {
				return false
			}
			for _, targetBase := range targetResolution.Definition.BaseTypes {
				entailed := false
				for _, sourceBase := range sourceResolution.Definition.BaseTypes {
					if visit(sourceBase, targetBase) {
						entailed = true
						break
					}
				}
				if !entailed {
					return false
				}
			}
			facts := entailment.Facts{}
			for _, base := range targetResolution.Definition.BaseTypes {
				if base.Flags()&shimchecker.TypeFlagsStringLike != 0 || shimchecker.Checker_isArrayType(checker, base) {
					facts.SubjectLength = true
				}
			}
			return entailment.Entails(sourceResolution.Definition.Predicates, targetResolution.Definition.Predicates, facts)
		}
		if sourceResolution.Refinement {
			if sourceResolution.Definition == nil || len(sourceResolution.Issues) > 0 {
				return false
			}
			for _, base := range sourceResolution.Definition.BaseTypes {
				if visit(base, target) {
					return true
				}
			}
			return false
		}

		if source.Flags()&shimchecker.TypeFlagsUnion != 0 {
			for _, part := range source.Types() {
				if !visit(part, target) {
					return false
				}
			}
			return true
		}
		if target.Flags()&shimchecker.TypeFlagsUnion != 0 {
			for _, part := range target.Types() {
				if visit(source, part) {
					return true
				}
			}
			return false
		}
		if source.Flags()&shimchecker.TypeFlagsTypeParameter != 0 {
			return visit(checker.GetBaseConstraintOfType(source), target)
		}
		if target.Flags()&shimchecker.TypeFlagsTypeParameter != 0 {
			return visit(source, checker.GetBaseConstraintOfType(target))
		}
		if source.Flags()&shimchecker.TypeFlagsObject == 0 || target.Flags()&shimchecker.TypeFlagsObject == 0 {
			return checker.IsTypeAssignableTo(source, target)
		}

		for _, targetProperty := range shimchecker.Checker_getPropertiesOfType(checker, target) {
			if targetProperty == nil || isRefinementBrand(targetProperty.Name) {
				continue
			}
			sourceProperty := checker.GetPropertyOfType(source, targetProperty.Name)
			if sourceProperty == nil {
				if targetProperty.Flags&shimast.SymbolFlagsOptional != 0 {
					continue
				}
				return false
			}
			if sourceProperty.Flags&shimast.SymbolFlagsOptional != 0 && targetProperty.Flags&shimast.SymbolFlagsOptional == 0 {
				return false
			}
			sourcePropertyType := shimchecker.Checker_getTypeOfPropertyOfType(checker, source, targetProperty.Name)
			targetPropertyType := shimchecker.Checker_getTypeOfPropertyOfType(checker, target, targetProperty.Name)
			if !visit(sourcePropertyType, targetPropertyType) {
				return false
			}
		}

		for _, targetIndex := range shimchecker.Checker_getIndexInfosOfType(checker, target) {
			segment, ok := analysis.IndexPathSegment(targetIndex.KeyType())
			if !ok {
				return false
			}
			for _, property := range shimchecker.Checker_getPropertiesOfType(checker, source) {
				if property != nil && matchesIndexName(segment, property.Name) &&
					!visit(shimchecker.Checker_getTypeOfPropertyOfType(checker, source, property.Name), targetIndex.ValueType()) {
					return false
				}
			}
			for _, sourceIndex := range shimchecker.Checker_getIndexInfosOfType(checker, source) {
				if indexTypeApplies(checker, sourceIndex.KeyType(), targetIndex.KeyType()) &&
					!visit(sourceIndex.ValueType(), targetIndex.ValueType()) {
					return false
				}
			}
		}

		return callSignaturesAreEntailed(checker, source, target, visit)
	}
	return visit(sourceType, targetType)
}

func signatureSymbolType(checker *shimchecker.Checker, symbol *shimast.Symbol) *shimchecker.Type {
	if checker == nil || symbol == nil {
		return nil
	}
	return shimchecker.Checker_getTypeOfSymbol(checker, symbol)
}

func signatureParameterType(
	checker *shimchecker.Checker,
	signature *shimchecker.Signature,
	index int,
) *shimchecker.Type {
	parameters := shimchecker.Signature_parameters(signature)
	restIndex := len(parameters) - 1
	if shimchecker.Signature_hasRestParameter(signature) && index >= restIndex {
		return shimchecker.Checker_getRestTypeOfSignature(checker, signature)
	}
	if index < 0 || index >= len(parameters) {
		return nil
	}
	return signatureSymbolType(checker, parameters[index])
}

func signatureIsEntailed(
	checker *shimchecker.Checker,
	source *shimchecker.Signature,
	target *shimchecker.Signature,
	visit func(*shimchecker.Type, *shimchecker.Type) bool,
) bool {
	if len(source.TypeParameters()) > 0 || len(target.TypeParameters()) > 0 ||
		checker.GetTypePredicateOfSignature(source) != nil || checker.GetTypePredicateOfSignature(target) != nil ||
		(source.ThisParameter() == nil) != (target.ThisParameter() == nil) {
		return false
	}
	if shimchecker.Checker_getMinArgumentCount(checker, source) > shimchecker.Checker_getMinArgumentCount(checker, target) {
		return false
	}
	if source.ThisParameter() != nil {
		if !visit(signatureSymbolType(checker, target.ThisParameter()), signatureSymbolType(checker, source.ThisParameter())) {
			return false
		}
	}
	for index := range shimchecker.Signature_parameterCount(source) {
		sourceParameter := signatureParameterType(checker, source, index)
		targetParameter := signatureParameterType(checker, target, index)
		if sourceParameter == nil || targetParameter != nil && !visit(targetParameter, sourceParameter) {
			return false
		}
	}
	targetReturn := shimchecker.Checker_getReturnTypeOfSignature(checker, target)
	return targetReturn != nil && (targetReturn.Flags()&shimchecker.TypeFlagsVoid != 0 ||
		visit(shimchecker.Checker_getReturnTypeOfSignature(checker, source), targetReturn))
}

func callSignaturesAreEntailed(
	checker *shimchecker.Checker,
	source *shimchecker.Type,
	target *shimchecker.Type,
	visit func(*shimchecker.Type, *shimchecker.Type) bool,
) bool {
	targetCalls := shimchecker.Checker_getSignaturesOfType(checker, target, shimchecker.SignatureKindCall)
	if len(targetCalls) == 0 || checker.IsTypeAssignableTo(source, target) {
		return true
	}
	sourceCalls := shimchecker.Checker_getSignaturesOfType(checker, source, shimchecker.SignatureKindCall)
	for _, targetCall := range targetCalls {
		matched := false
		for _, sourceCall := range sourceCalls {
			if signatureIsEntailed(checker, sourceCall, targetCall, visit) {
				matched = true
				break
			}
		}
		if !matched {
			return false
		}
	}
	return true
}

func indexTypeApplies(checker *shimchecker.Checker, source, target *shimchecker.Type) bool {
	return checker.IsTypeAssignableTo(source, target) ||
		target.Flags()&shimchecker.TypeFlagsString != 0 && source.Flags()&shimchecker.TypeFlagsNumberLike != 0
}

func isRefinementBrand(name string) bool {
	return strings.Contains(name, "refinementBrand")
}
