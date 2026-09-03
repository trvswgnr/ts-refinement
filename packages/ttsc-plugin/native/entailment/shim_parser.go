package entailment

import (
	"fmt"
	"sort"

	shimast "github.com/microsoft/typescript-go/shim/ast"
	shimcore "github.com/microsoft/typescript-go/shim/core"
	shimparser "github.com/microsoft/typescript-go/shim/parser"
	shimscanner "github.com/microsoft/typescript-go/shim/scanner"
)

const predicatePrefix = "const __predicate = ("

type predicateReference struct {
	end       int
	name      string
	shorthand bool
	start     int
}

type parsedPredicateSource struct {
	freeNames  []string
	references []predicateReference
	source     string
}

func parsePredicateSource(source string) (parsedPredicateSource, error) {
	wrapped := predicatePrefix + source + ");"
	file := shimparser.ParseSourceFile(
		shimast.SourceFileParseOptions{FileName: "/__ts_refinement_predicate.js"},
		wrapped,
		shimcore.ScriptKindJS,
	)
	if file == nil || len(file.Diagnostics()) > 0 || file.Statements == nil || len(file.Statements.Nodes) != 1 {
		return parsedPredicateSource{}, fmt.Errorf("invalid refinement JavaScript expression")
	}
	statement := file.Statements.Nodes[0]
	if statement.Kind != shimast.KindVariableStatement {
		return parsedPredicateSource{}, fmt.Errorf("invalid refinement JavaScript expression")
	}
	declarationList := statement.AsVariableStatement().DeclarationList.AsVariableDeclarationList()
	if declarationList.Declarations == nil || len(declarationList.Declarations.Nodes) != 1 {
		return parsedPredicateSource{}, fmt.Errorf("invalid refinement JavaScript expression")
	}
	initializer := declarationList.Declarations.Nodes[0].AsVariableDeclaration().Initializer
	if initializer == nil || initializer.Kind != shimast.KindParenthesizedExpression {
		return parsedPredicateSource{}, fmt.Errorf("invalid refinement JavaScript expression")
	}
	expression := initializer.AsParenthesizedExpression().Expression
	if expression == nil {
		return parsedPredicateSource{}, fmt.Errorf("invalid refinement JavaScript expression")
	}
	if err := validateShimPredicate(expression); err != nil {
		return parsedPredicateSource{}, err
	}
	references, err := shimPredicateReferences(file, expression)
	if err != nil {
		return parsedPredicateSource{}, err
	}
	free := map[string]struct{}{}
	for _, reference := range references {
		free[reference.name] = struct{}{}
	}
	freeNames := make([]string, 0, len(free))
	for name := range free {
		freeNames = append(freeNames, name)
	}
	sort.Strings(freeNames)
	sort.Slice(references, func(left, right int) bool {
		return references[left].start < references[right].start
	})
	return parsedPredicateSource{freeNames: freeNames, references: references, source: source}, nil
}

func validateShimPredicate(root *shimast.Node) error {
	var validationError error
	var visit func(*shimast.Node)
	visit = func(current *shimast.Node) {
		if current == nil || validationError != nil {
			return
		}
		switch current.Kind {
		case shimast.KindAwaitExpression, shimast.KindBlock, shimast.KindDeleteExpression,
			shimast.KindMetaProperty, shimast.KindYieldExpression, shimast.KindThisKeyword,
			shimast.KindPostfixUnaryExpression:
			validationError = fmt.Errorf("refinement expression uses syntax that is not allowed in predicates")
			return
		case shimast.KindPrefixUnaryExpression:
			operator := current.AsPrefixUnaryExpression().Operator
			if operator == shimast.KindPlusPlusToken || operator == shimast.KindMinusMinusToken {
				validationError = fmt.Errorf("refinement expression uses syntax that is not allowed in predicates")
				return
			}
		case shimast.KindBinaryExpression:
			operator := current.AsBinaryExpression().OperatorToken
			if operator != nil && operator.Kind >= shimast.KindFirstAssignment && operator.Kind <= shimast.KindLastAssignment {
				validationError = fmt.Errorf("refinement expression uses syntax that is not allowed in predicates")
				return
			}
		case shimast.KindCallExpression:
			if current.AsCallExpression().Expression.Kind == shimast.KindImportKeyword {
				validationError = fmt.Errorf("refinement expression uses syntax that is not allowed in predicates")
				return
			}
		}
		if isMathRandomAccess(current) {
			validationError = fmt.Errorf("global Math.random is not allowed")
			return
		}
		current.ForEachChild(func(child *shimast.Node) bool {
			visit(child)
			return validationError != nil
		})
	}
	visit(root)
	return validationError
}

func isMathRandomAccess(current *shimast.Node) bool {
	if current == nil {
		return false
	}
	switch current.Kind {
	case shimast.KindPropertyAccessExpression:
		access := current.AsPropertyAccessExpression()
		return access.Expression.Kind == shimast.KindIdentifier && access.Expression.Text() == "Math" && access.Name().Text() == "random"
	case shimast.KindElementAccessExpression:
		access := current.AsElementAccessExpression()
		if access.Expression.Kind != shimast.KindIdentifier || access.Expression.Text() != "Math" || access.ArgumentExpression == nil {
			return false
		}
		return (access.ArgumentExpression.Kind == shimast.KindStringLiteral ||
			access.ArgumentExpression.Kind == shimast.KindNoSubstitutionTemplateLiteral) && access.ArgumentExpression.Text() == "random"
	default:
		return false
	}
}

func shimPredicateReferences(file *shimast.SourceFile, root *shimast.Node) ([]predicateReference, error) {
	references := []predicateReference{}
	var analysisError error
	var visit func(*shimast.Node, map[string]struct{})
	visit = func(current *shimast.Node, locals map[string]struct{}) {
		if current == nil || analysisError != nil {
			return
		}
		if shimast.IsFunctionLike(current) {
			locals = cloneNames(locals)
			if name := current.Name(); name != nil {
				collectBindingNames(name, locals)
			}
			for _, parameter := range current.Parameters() {
				collectBindingNames(parameter.Name(), locals)
			}
		}
		if current.Kind == shimast.KindIdentifier && isIdentifierReference(current) {
			name := current.Text()
			if _, local := locals[name]; !local {
				if disallowedGlobals[name] {
					analysisError = fmt.Errorf("global %s is not allowed", name)
					return
				}
				if !standardGlobals[name] {
					start := shimscanner.SkipTrivia(file.Text(), current.Pos()) - len(predicatePrefix)
					end := current.End() - len(predicatePrefix)
					if start < 0 || end < start || end > len(file.Text())-len(predicatePrefix)-2 {
						analysisError = fmt.Errorf("invalid predicate identifier range")
						return
					}
					references = append(references, predicateReference{
						end:       end,
						name:      name,
						shorthand: isShorthandReference(current),
						start:     start,
					})
				}
			}
		}
		current.ForEachChild(func(child *shimast.Node) bool {
			visit(child, locals)
			return analysisError != nil
		})
	}
	visit(root, map[string]struct{}{})
	return references, analysisError
}

func cloneNames(names map[string]struct{}) map[string]struct{} {
	clone := make(map[string]struct{}, len(names))
	for name := range names {
		clone[name] = struct{}{}
	}
	return clone
}

func collectBindingNames(binding *shimast.Node, names map[string]struct{}) {
	if binding == nil {
		return
	}
	if binding.Kind == shimast.KindIdentifier {
		names[binding.Text()] = struct{}{}
		return
	}
	if binding.Kind == shimast.KindObjectBindingPattern || binding.Kind == shimast.KindArrayBindingPattern {
		for _, element := range binding.AsBindingPattern().Elements.Nodes {
			if element.Kind != shimast.KindOmittedExpression {
				collectBindingNames(element.AsBindingElement().Name(), names)
			}
		}
	}
}

func isIdentifierReference(identifier *shimast.Node) bool {
	parent := identifier.Parent
	if parent == nil {
		return true
	}
	if parent.Kind == shimast.KindShorthandPropertyAssignment && parent.AsShorthandPropertyAssignment().Name() == identifier {
		return true
	}
	if parent.Kind == shimast.KindPropertyAccessExpression && parent.AsPropertyAccessExpression().Name() == identifier {
		return false
	}
	if parent.Kind == shimast.KindPropertyAssignment && parent.AsPropertyAssignment().Name() == identifier {
		return false
	}
	return !shimast.IsDeclarationNameOrImportPropertyName(identifier)
}

func isShorthandReference(identifier *shimast.Node) bool {
	parent := identifier.Parent
	return parent != nil && parent.Kind == shimast.KindShorthandPropertyAssignment && parent.AsShorthandPropertyAssignment().Name() == identifier
}

func (parsed parsedPredicateSource) subject(captures map[string]*node) (string, error) {
	subjects := []string{}
	for _, name := range parsed.freeNames {
		if captures[name] == nil {
			subjects = append(subjects, name)
		}
	}
	if len(subjects) > 1 {
		return "", fmt.Errorf("cannot infer subject from %d identifiers", len(subjects))
	}
	if len(subjects) == 1 {
		return subjects[0], nil
	}
	return "", nil
}

func (parsed parsedPredicateSource) opaque(captures map[string]*node) *node {
	root := &node{kind: nodeOpaque, text: parsed.source}
	for _, reference := range parsed.references {
		replacement := &node{kind: nodeIdentifier, text: reference.name}
		if capture := captures[reference.name]; capture != nil {
			replacement = cloneNode(capture)
		}
		shorthand := ""
		if reference.shorthand {
			shorthand = reference.name
		}
		root.args = append(root.args, replacement)
		root.spans = append(root.spans, sourceSpan{start: reference.start, end: reference.end, shorthand: shorthand})
	}
	return root
}
