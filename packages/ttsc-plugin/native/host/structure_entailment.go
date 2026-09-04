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
		for _, kind := range []shimchecker.SignatureKind{shimchecker.SignatureKindCall, shimchecker.SignatureKindConstruct} {
			for _, signature := range shimchecker.Checker_getSignaturesOfType(checker, target, kind) {
				has, valid := visit(shimchecker.Checker_getReturnTypeOfSignature(checker, signature))
				if !valid || has {
					return has, valid
				}
				has, valid = visit(signatureSymbolType(checker, signature.ThisParameter()))
				if !valid || has {
					return has, valid
				}
				parameters := signatureParameters(checker, signature)
				for _, parameter := range parameters.fixed {
					has, valid = visit(parameter)
					if !valid || has {
						return has, valid
					}
				}
				has, valid = visit(parameters.rest)
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

		if source.Flags()&shimchecker.TypeFlagsTypeParameter != 0 {
			return visit(checker.GetBaseConstraintOfType(source), target)
		}
		if target.Flags()&shimchecker.TypeFlagsTypeParameter != 0 {
			return false
		}
		if result, handled := collectionEntailment(checker, source, target, visit); handled {
			return result
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
				if indexTypesOverlap(checker, sourceIndex.KeyType(), targetIndex.KeyType()) &&
					!visit(sourceIndex.ValueType(), targetIndex.ValueType()) {
					return false
				}
			}
		}

		return signaturesAreEntailed(checker, source, target, shimchecker.SignatureKindCall, visit) &&
			signaturesAreEntailed(checker, source, target, shimchecker.SignatureKindConstruct, visit)
	}
	return visit(sourceType, targetType)
}

func collectionEntailment(
	checker *shimchecker.Checker,
	source, target *shimchecker.Type,
	visit func(*shimchecker.Type, *shimchecker.Type) bool,
) (bool, bool) {
	if shimchecker.IsTupleType(target) {
		if !shimchecker.IsTupleType(source) {
			return false, true
		}
		sourceTuple := source.TargetTupleType()
		targetTuple := target.TargetTupleType()
		if sourceTuple.IsReadonly() && !targetTuple.IsReadonly() {
			return false, true
		}
		sourceElements := tupleElements(checker, source)
		targetElements := tupleElements(checker, target)
		if sourceElements.minimum < targetElements.minimum {
			return false, true
		}
		if sourceElements.rest != nil && targetElements.rest == nil {
			return false, true
		}
		if targetElements.rest == nil && len(sourceElements.fixed) > len(targetElements.fixed) {
			return false, true
		}
		for index, element := range sourceElements.fixed {
			targetElement := signatureParameterAt(targetElements, index)
			if targetElement == nil || !visit(element, targetElement) {
				return false, true
			}
		}
		if sourceElements.rest != nil && (targetElements.rest == nil || !visit(sourceElements.rest, targetElements.rest)) {
			return false, true
		}
		return true, true
	}

	targetElement := collectionArrayElement(checker, target)
	if targetElement == nil {
		return false, false
	}
	if isReadonlyArrayType(source) && !isReadonlyArrayType(target) {
		return false, true
	}
	if shimchecker.IsTupleType(source) {
		for _, element := range shimchecker.Checker_getTypeArguments(checker, source) {
			if !visit(element, targetElement) {
				return false, true
			}
		}
		return true, true
	}
	sourceElement := collectionArrayElement(checker, source)
	return sourceElement != nil && visit(sourceElement, targetElement), true
}

func tupleElements(checker *shimchecker.Checker, target *shimchecker.Type) signatureParameterSequence {
	result := signatureParameterSequence{}
	arguments := shimchecker.Checker_getTypeArguments(checker, target)
	flags := target.TargetTupleType().ElementFlags()
	for index, element := range arguments {
		elementFlags := shimchecker.ElementFlagsRequired
		if index < len(flags) {
			elementFlags = flags[index]
		}
		if elementFlags&(shimchecker.ElementFlagsRest|shimchecker.ElementFlagsVariadic) != 0 {
			result.rest = element
			break
		}
		result.fixed = append(result.fixed, element)
		if elementFlags&shimchecker.ElementFlagsRequired != 0 {
			result.minimum = len(result.fixed)
		}
	}
	return result
}

func collectionArrayElement(checker *shimchecker.Checker, target *shimchecker.Type) *shimchecker.Type {
	if !shimchecker.Checker_isArrayType(checker, target) {
		return nil
	}
	arguments := shimchecker.Checker_getTypeArguments(checker, target)
	if len(arguments) == 0 {
		return nil
	}
	return arguments[0]
}

func isReadonlyArrayType(target *shimchecker.Type) bool {
	symbol := target.Symbol()
	return symbol != nil && symbol.Name == "ReadonlyArray"
}

func signatureSymbolType(checker *shimchecker.Checker, symbol *shimast.Symbol) *shimchecker.Type {
	if checker == nil || symbol == nil {
		return nil
	}
	return shimchecker.Checker_getTypeOfSymbol(checker, symbol)
}

type signatureParameterSequence struct {
	fixed   []*shimchecker.Type
	minimum int
	rest    *shimchecker.Type
}

func signatureParameters(
	checker *shimchecker.Checker,
	signature *shimchecker.Signature,
) signatureParameterSequence {
	result := signatureParameterSequence{minimum: shimchecker.Checker_getMinArgumentCount(checker, signature)}
	parameters := shimchecker.Signature_parameters(signature)
	for index, parameter := range parameters {
		parameterType := signatureSymbolType(checker, parameter)
		if shimchecker.Signature_hasRestParameter(signature) && index == len(parameters)-1 {
			if shimchecker.IsTupleType(parameterType) {
				arguments := shimchecker.Checker_getTypeArguments(checker, parameterType)
				flags := parameterType.TargetTupleType().ElementFlags()
				for elementIndex, element := range arguments {
					elementFlags := shimchecker.ElementFlagsRequired
					if elementIndex < len(flags) {
						elementFlags = flags[elementIndex]
					}
					if elementFlags&(shimchecker.ElementFlagsRest|shimchecker.ElementFlagsVariadic) != 0 {
						result.rest = element
						break
					}
					result.fixed = append(result.fixed, element)
				}
			} else {
				result.rest = shimchecker.Checker_getRestTypeOfSignature(checker, signature)
			}
			continue
		}
		result.fixed = append(result.fixed, parameterType)
	}
	return result
}

func signatureParameterAt(parameters signatureParameterSequence, index int) *shimchecker.Type {
	if index >= 0 && index < len(parameters.fixed) {
		return parameters.fixed[index]
	}
	if index >= len(parameters.fixed) {
		return parameters.rest
	}
	return nil
}

func signatureIsEntailed(
	checker *shimchecker.Checker,
	source *shimchecker.Signature,
	target *shimchecker.Signature,
	visit func(*shimchecker.Type, *shimchecker.Type) bool,
) bool {
	if checker.GetTypePredicateOfSignature(source) != nil || checker.GetTypePredicateOfSignature(target) != nil ||
		(source.ThisParameter() == nil) != (target.ThisParameter() == nil) {
		return false
	}
	sourceTypeParameters := source.TypeParameters()
	targetTypeParameters := target.TypeParameters()
	if len(sourceTypeParameters) != len(targetTypeParameters) {
		return false
	}
	equivalents := map[*shimchecker.Type]*shimchecker.Type{}
	for index, sourceParameter := range sourceTypeParameters {
		targetParameter := targetTypeParameters[index]
		equivalents[sourceParameter] = targetParameter
		equivalents[targetParameter] = sourceParameter
	}
	scopedVisit := func(sourceType, targetType *shimchecker.Type) bool {
		return equivalents[sourceType] == targetType || visit(sourceType, targetType)
	}
	for index, sourceParameter := range sourceTypeParameters {
		targetParameter := targetTypeParameters[index]
		sourceConstraint := checker.GetBaseConstraintOfType(sourceParameter)
		targetConstraint := checker.GetBaseConstraintOfType(targetParameter)
		if sourceConstraint == nil || targetConstraint == nil {
			if sourceConstraint != targetConstraint {
				return false
			}
			continue
		}
		if !scopedVisit(sourceConstraint, targetConstraint) || !scopedVisit(targetConstraint, sourceConstraint) {
			return false
		}
	}
	sourceParameters := signatureParameters(checker, source)
	targetParameters := signatureParameters(checker, target)
	if sourceParameters.minimum > targetParameters.minimum {
		return false
	}
	if source.ThisParameter() != nil {
		if !scopedVisit(signatureSymbolType(checker, target.ThisParameter()), signatureSymbolType(checker, source.ThisParameter())) {
			return false
		}
	}
	fixedCount := max(len(sourceParameters.fixed), len(targetParameters.fixed))
	for index := range fixedCount {
		sourceParameter := signatureParameterAt(sourceParameters, index)
		targetParameter := signatureParameterAt(targetParameters, index)
		if sourceParameter != nil && targetParameter != nil && !scopedVisit(targetParameter, sourceParameter) {
			return false
		}
	}
	if sourceParameters.rest != nil && targetParameters.rest != nil && !scopedVisit(targetParameters.rest, sourceParameters.rest) {
		return false
	}
	targetReturn := shimchecker.Checker_getReturnTypeOfSignature(checker, target)
	return targetReturn != nil && (targetReturn.Flags()&shimchecker.TypeFlagsVoid != 0 ||
		scopedVisit(shimchecker.Checker_getReturnTypeOfSignature(checker, source), targetReturn))
}

func signaturesAreEntailed(
	checker *shimchecker.Checker,
	source *shimchecker.Type,
	target *shimchecker.Type,
	kind shimchecker.SignatureKind,
	visit func(*shimchecker.Type, *shimchecker.Type) bool,
) bool {
	targetSignatures := shimchecker.Checker_getSignaturesOfType(checker, target, kind)
	if len(targetSignatures) == 0 || checker.IsTypeAssignableTo(source, target) {
		return true
	}
	sourceSignatures := shimchecker.Checker_getSignaturesOfType(checker, source, kind)
	for _, targetSignature := range targetSignatures {
		matched := false
		for _, sourceSignature := range sourceSignatures {
			if signatureIsEntailed(checker, sourceSignature, targetSignature, visit) {
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

func indexTypesOverlap(checker *shimchecker.Checker, source, target *shimchecker.Type) bool {
	return checker.IsTypeAssignableTo(source, target) || checker.IsTypeAssignableTo(target, source) ||
		source.Flags()&shimchecker.TypeFlagsString != 0 && target.Flags()&shimchecker.TypeFlagsNumberLike != 0 ||
		target.Flags()&shimchecker.TypeFlagsString != 0 && source.Flags()&shimchecker.TypeFlagsNumberLike != 0
}

func isRefinementBrand(name string) bool {
	return strings.Contains(name, "refinementBrand")
}
