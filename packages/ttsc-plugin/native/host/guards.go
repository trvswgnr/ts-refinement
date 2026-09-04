package host

import (
	"sort"
	"strings"

	shimast "github.com/microsoft/typescript-go/shim/ast"
	shimchecker "github.com/microsoft/typescript-go/shim/checker"

	"github.com/ts-refinement/ttsc-plugin/native/entailment"
)

type guardSource struct {
	condition *shimast.Node
	negated   bool
	region    *shimast.Node
}

func collectGuardPredicates(
	checker *shimchecker.Checker,
	file *shimast.SourceFile,
	site assertion,
) []entailment.Predicate {
	if checker == nil || file == nil || site.expression == nil || site.expression.Kind != shimast.KindIdentifier {
		return nil
	}
	subject := checker.GetSymbolAtLocation(site.expression)
	if subject == nil {
		return nil
	}
	predicates := []entailment.Predicate{}
	for _, source := range enclosingGuardSources(site.node) {
		if hasUnsafeInterveningNode(file, source.region, site.node) {
			continue
		}
		predicate, ok := normalizeGuardPredicate(checker, file, source, subject)
		if ok {
			predicates = append(predicates, predicate)
		}
	}
	return predicates
}

func enclosingGuardSources(assertion *shimast.Node) []guardSource {
	sources := []guardSource{}
	current := assertion
	for parent := current.Parent; parent != nil; parent = parent.Parent {
		if shimast.IsFunctionLike(parent) {
			break
		}
		switch parent.Kind {
		case shimast.KindIfStatement:
			statement := parent.AsIfStatement()
			if statement.ThenStatement == current {
				sources = append(sources, guardSource{condition: statement.Expression, region: current})
			} else if statement.ElseStatement == current {
				sources = append(sources, guardSource{condition: statement.Expression, negated: true, region: current})
			}
		case shimast.KindConditionalExpression:
			expression := parent.AsConditionalExpression()
			if expression.WhenTrue == current {
				sources = append(sources, guardSource{condition: expression.Condition, region: current})
			} else if expression.WhenFalse == current {
				sources = append(sources, guardSource{condition: expression.Condition, negated: true, region: current})
			}
		case shimast.KindBinaryExpression:
			expression := parent.AsBinaryExpression()
			if expression.OperatorToken != nil && expression.OperatorToken.Kind == shimast.KindAmpersandAmpersandToken && expression.Right == current {
				sources = append(sources, guardSource{condition: expression.Left, region: current})
			}
		}
		current = parent
	}
	return sources
}

func normalizeGuardPredicate(
	checker *shimchecker.Checker,
	file *shimast.SourceFile,
	source guardSource,
	subject *shimast.Symbol,
) (entailment.Predicate, bool) {
	if source.condition == nil {
		return entailment.Predicate{}, false
	}
	conditionStart := tokenStart(file, source.condition)
	conditionText := nodeText(file, source.condition)
	references := []*shimast.Node{}
	supported := true
	var visit func(*shimast.Node)
	visit = func(node *shimast.Node) {
		if node == nil || !supported {
			return
		}
		switch node.Kind {
		case shimast.KindPropertyAccessExpression, shimast.KindElementAccessExpression,
			shimast.KindCallExpression, shimast.KindNewExpression:
			supported = false
			return
		case shimast.KindIdentifier:
			if checker.GetSymbolAtLocation(node) != subject {
				supported = false
				return
			}
			references = append(references, node)
		}
		node.ForEachChild(func(child *shimast.Node) bool {
			visit(child)
			return false
		})
	}
	visit(source.condition)
	if !supported || len(references) == 0 {
		return entailment.Predicate{}, false
	}
	sort.Slice(references, func(left, right int) bool {
		return tokenStart(file, references[left]) > tokenStart(file, references[right])
	})
	marker := "__ts_refinement_guard_subject__"
	for strings.Contains(conditionText, marker) {
		marker = "_" + marker
	}
	for _, reference := range references {
		start := tokenStart(file, reference) - conditionStart
		end := reference.End() - conditionStart
		if start < 0 || end < start || end > len(conditionText) {
			return entailment.Predicate{}, false
		}
		conditionText = conditionText[:start] + marker + conditionText[end:]
	}
	if source.negated {
		conditionText = "!(" + conditionText + ")"
	}
	predicate, err := entailment.ParsePredicate(conditionText)
	return predicate, err == nil
}

func hasUnsafeInterveningNode(file *shimast.SourceFile, region, assertion *shimast.Node) bool {
	if region == nil || assertion == nil {
		return true
	}
	assertionStart := tokenStart(file, assertion)
	unsafe := false
	var visit func(*shimast.Node)
	visit = func(node *shimast.Node) {
		if node == nil || unsafe || node == assertion || tokenStart(file, node) >= assertionStart {
			return
		}
		if node != region && shimast.IsFunctionLike(node) {
			unsafe = true
			return
		}
		switch node.Kind {
		case shimast.KindCallExpression, shimast.KindNewExpression,
			shimast.KindForStatement, shimast.KindForInStatement, shimast.KindForOfStatement,
			shimast.KindWhileStatement, shimast.KindDoStatement:
			unsafe = true
			return
		case shimast.KindPrefixUnaryExpression:
			operator := node.AsPrefixUnaryExpression().Operator
			if operator == shimast.KindPlusPlusToken || operator == shimast.KindMinusMinusToken {
				unsafe = true
				return
			}
		case shimast.KindPostfixUnaryExpression:
			unsafe = true
			return
		case shimast.KindBinaryExpression:
			operator := node.AsBinaryExpression().OperatorToken
			if operator != nil && operator.Kind >= shimast.KindFirstAssignment && operator.Kind <= shimast.KindLastAssignment {
				unsafe = true
				return
			}
		}
		node.ForEachChild(func(child *shimast.Node) bool {
			visit(child)
			return false
		})
	}
	visit(region)
	return unsafe
}
