package host

import (
	"fmt"
	"math"
	"reflect"
	"regexp"
	"strconv"
	"strings"

	shimast "github.com/microsoft/typescript-go/shim/ast"

	"github.com/ts-refinement/ttsc-plugin/native/analysis"
	"github.com/ts-refinement/ttsc-plugin/native/entailment"
)

var identifierProperty = regexp.MustCompile(`^[A-Za-z_$][A-Za-z0-9_$]*$`)
var decimalNumber = regexp.MustCompile(`^[+-]?(?:(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?)$`)
var prefixedNumber = regexp.MustCompile(`^0(?:[xX][0-9A-Fa-f]+|[oO][0-7]+|[bB][01]+)$`)
var bigintIndexValue = regexp.MustCompile(`^-?(?:0|[1-9][0-9]*|0[xX][0-9A-Fa-f]+|0[oO][0-7]+|0[bB][01]+)$`)

type staticLeaf struct {
	node *shimast.Node
	path string
}

func proveNestedChecks(
	file *shimast.SourceFile,
	site assertion,
	checks []analysis.Check,
) (bool, *protocolDiagnostic) {
	allKnown := true
	for _, check := range checks {
		if len(check.Path) == 0 {
			continue
		}
		leaves, known := staticLeavesAtPath(file, site.expression, check.Path, "")
		if !known {
			allKnown = false
			continue
		}
		for _, leaf := range leaves {
			source := nodeText(file, leaf.node)
			for _, predicate := range check.Definition.Predicates {
				result, known := entailment.Evaluate(predicate, source)
				if !known {
					allKnown = false
					continue
				}
				if !result {
					atPath := ""
					if leaf.path != "" {
						atPath = fmt.Sprintf(" at '%s'", leaf.path)
					}
					message := fmt.Sprintf(
						"Value '%s'%s does not satisfy refinement '%s'. Predicate: %s.",
						source,
						atPath,
						check.Definition.Display,
						predicate.Source,
					)
					diagnostic := nodeDiagnostic(file, site.node, analysis.DiagnosticStaticallyDisproven, message)
					return false, &diagnostic
				}
			}
		}
	}
	return allKnown, nil
}

func staticLeavesAtPath(
	file *shimast.SourceFile,
	node *shimast.Node,
	segments []analysis.PathSegment,
	path string,
) ([]staticLeaf, bool) {
	node = unwrapStaticExpression(node)
	if len(segments) == 0 {
		return []staticLeaf{{node: node, path: path}}, node != nil
	}
	if node == nil {
		return nil, false
	}
	segment := segments[0]
	remaining := segments[1:]
	switch segment.Kind {
	case analysis.PathUnion:
		properties, known := staticObjectProperties(node)
		if !known {
			return nil, false
		}
		discriminant, exists := properties[segment.Property]
		if !exists {
			return nil, false
		}
		value, known := staticLiteralValue(file, discriminant)
		if !known {
			return nil, false
		}
		if !reflect.DeepEqual(value, segment.Value) {
			return nil, true
		}
		return staticLeavesAtPath(file, node, remaining, path)
	case analysis.PathProperty:
		properties, known := staticObjectProperties(node)
		if !known {
			return nil, false
		}
		child, exists := properties[segment.Name]
		if !exists {
			if segment.Optional {
				return nil, true
			}
			return nil, false
		}
		return staticLeavesAtPath(file, child, remaining, propertyPath(path, segment.Name))
	case analysis.PathTuple:
		elements, known := staticArrayElements(node)
		if !known {
			return nil, false
		}
		if segment.Index >= len(elements) {
			if segment.Optional {
				return nil, true
			}
			return nil, false
		}
		return staticLeavesAtPath(file, elements[segment.Index], remaining, fmt.Sprintf("%s[%d]", path, segment.Index))
	case analysis.PathArray, analysis.PathTupleRest:
		elements, known := staticArrayElements(node)
		if !known {
			return nil, false
		}
		start := 0
		if segment.Kind == analysis.PathTupleRest {
			start = segment.Start
		}
		leaves := []staticLeaf{}
		for index := start; index < len(elements); index++ {
			children, known := staticLeavesAtPath(file, elements[index], remaining, fmt.Sprintf("%s[%d]", path, index))
			if !known {
				return nil, false
			}
			leaves = append(leaves, children...)
		}
		return leaves, true
	case analysis.PathIndex:
		if segment.Key == "symbol" {
			return nil, false
		}
		properties, known := staticObjectProperties(node)
		if !known {
			return nil, false
		}
		leaves := []staticLeaf{}
		for name, child := range properties {
			if !matchesIndexName(segment, name) {
				continue
			}
			children, known := staticLeavesAtPath(file, child, remaining, propertyPath(path, name))
			if !known {
				return nil, false
			}
			leaves = append(leaves, children...)
		}
		return leaves, true
	default:
		return nil, false
	}
}

func matchesIndexName(segment analysis.PathSegment, name string) bool {
	switch segment.Key {
	case "string":
		return true
	case "number":
		if name == "-0" {
			return false
		}
		value, err := strconv.ParseFloat(name, 64)
		return err == nil && strconv.FormatFloat(value, 'g', -1, 64) == name || name == "NaN" || name == "Infinity" || name == "-Infinity"
	case "template":
		captures, ok := templateIndexCaptures(segment.Pattern, name)
		if !ok {
			return false
		}
		for index, capture := range captures {
			switch segment.Pattern.Placeholders[index] {
			case "number":
				if !isTemplateNumber(capture) {
					return false
				}
			case "bigint":
				if !bigintIndexValue.MatchString(capture) {
					return false
				}
			}
		}
		return true
	default:
		return false
	}
}

func templateIndexCaptures(pattern *analysis.IndexPattern, name string) ([]string, bool) {
	if pattern == nil || len(pattern.Texts) != len(pattern.Placeholders)+1 {
		return nil, false
	}
	var source strings.Builder
	source.WriteString("^")
	for index, text := range pattern.Texts {
		source.WriteString(regexp.QuoteMeta(text))
		if index < len(pattern.Placeholders) {
			source.WriteString("(?s:(.*?))")
		}
	}
	source.WriteString("$")
	match := regexp.MustCompile(source.String()).FindStringSubmatch(name)
	if match == nil {
		return nil, false
	}
	return match[1:], true
}

func isTemplateNumber(value string) bool {
	if value == "" {
		return false
	}
	trimmed := strings.TrimSpace(value)
	if prefixedNumber.MatchString(trimmed) {
		return true
	}
	if !decimalNumber.MatchString(trimmed) {
		return false
	}
	number, err := strconv.ParseFloat(trimmed, 64)
	return err == nil && !math.IsInf(number, 0) && !math.IsNaN(number)
}

func unwrapStaticExpression(node *shimast.Node) *shimast.Node {
	for node != nil {
		switch node.Kind {
		case shimast.KindParenthesizedExpression, shimast.KindAsExpression,
			shimast.KindTypeAssertionExpression, shimast.KindSatisfiesExpression:
			node = node.Expression()
		default:
			return node
		}
	}
	return nil
}

func staticObjectProperties(node *shimast.Node) (map[string]*shimast.Node, bool) {
	node = unwrapStaticExpression(node)
	if node == nil || node.Kind != shimast.KindObjectLiteralExpression {
		return nil, false
	}
	properties := map[string]*shimast.Node{}
	for _, property := range node.AsObjectLiteralExpression().Properties.Nodes {
		if property.Kind != shimast.KindPropertyAssignment {
			return nil, false
		}
		assignment := property.AsPropertyAssignment()
		name, known := staticPropertyName(assignment.Name())
		if !known {
			return nil, false
		}
		properties[name] = assignment.Initializer
	}
	return properties, true
}

func staticPropertyName(node *shimast.Node) (string, bool) {
	if node == nil {
		return "", false
	}
	switch node.Kind {
	case shimast.KindIdentifier, shimast.KindStringLiteral, shimast.KindNumericLiteral:
		return node.Text(), true
	default:
		return "", false
	}
}

func staticArrayElements(node *shimast.Node) ([]*shimast.Node, bool) {
	node = unwrapStaticExpression(node)
	if node == nil || node.Kind != shimast.KindArrayLiteralExpression {
		return nil, false
	}
	elements := node.AsArrayLiteralExpression().Elements.Nodes
	for _, element := range elements {
		if element.Kind == shimast.KindSpreadElement || element.Kind == shimast.KindOmittedExpression {
			return nil, false
		}
	}
	return elements, true
}

func staticLiteralValue(file *shimast.SourceFile, node *shimast.Node) (any, bool) {
	node = unwrapStaticExpression(node)
	if node == nil {
		return nil, false
	}
	switch node.Kind {
	case shimast.KindStringLiteral:
		return node.Text(), true
	case shimast.KindNumericLiteral:
		value, err := strconv.ParseFloat(strings.ReplaceAll(node.Text(), "_", ""), 64)
		return value, err == nil
	case shimast.KindTrueKeyword:
		return true, true
	case shimast.KindFalseKeyword:
		return false, true
	case shimast.KindNullKeyword:
		return nil, true
	default:
		return nil, false
	}
}

func propertyPath(path, name string) string {
	if identifierProperty.MatchString(name) {
		return path + "." + name
	}
	return path + "[" + quoted(name) + "]"
}
