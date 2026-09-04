package host

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"github.com/ts-refinement/ttsc-plugin/native/analysis"
	"github.com/ts-refinement/ttsc-plugin/native/entailment"
)

type traversalLeaf func(subject, path, indent string) []string
type traversalGuard func(subject, path string, segment analysis.PathSegment, indent string) []string

func emitValidator(
	checks []analysis.Check,
	recursions []analysis.Recursion,
	errorAlias string,
	marker string,
) string {
	if len(recursions) == 0 {
		parts := make([]string, 0, len(checks))
		for index, check := range checks {
			parts = append(parts, emitCheck(check, fmt.Sprintf("%d", index), "__ts_refinement_value", `""`, "    ", errorAlias, marker))
		}
		return strings.Join(parts, "\n")
	}

	targetPaths := [][]analysis.PathSegment{nil}
	targetIndexes := map[string]int{pathKey(nil): 0}
	for _, recursion := range recursions {
		key := pathKey(recursion.TargetPath)
		if _, exists := targetIndexes[key]; !exists {
			targetIndexes[key] = len(targetPaths)
			targetPaths = append(targetPaths, recursion.TargetPath)
		}
	}
	functions := make([]string, 0, len(targetPaths))
	for functionIndex, targetPath := range targetPaths {
		lines := []string{
			fmt.Sprintf("  function __ts_refinement_validate%d(subject: any, path: string, seen: WeakSet<object>[]): void {", functionIndex),
			"    if ((typeof subject === \"object\" && subject !== null) || typeof subject === \"function\") {",
			fmt.Sprintf("      if (seen[%d].has(subject)) return;", functionIndex),
			fmt.Sprintf("      seen[%d].add(subject);", functionIndex),
			"    }",
		}
		for checkIndex, check := range checks {
			relative := relativePath(check.Path, targetPath)
			if relative == nil {
				continue
			}
			lines = append(lines, emitCheck(
				analysis.Check{Definition: check.Definition, Path: relative},
				fmt.Sprintf("%d_%d", functionIndex, checkIndex),
				"subject",
				"path",
				"    ",
				errorAlias,
				marker,
			))
		}
		for recursionIndex, recursion := range recursions {
			relative := relativePath(recursion.Path, targetPath)
			targetIndex, exists := targetIndexes[pathKey(recursion.TargetPath)]
			if relative == nil || !exists {
				continue
			}
			var guard traversalGuard
			if len(checks) > 0 {
				guardCheck := checks[0]
				for _, check := range checks {
					if relativePath(check.Path, targetPath) != nil {
						guardCheck = check
						break
					}
				}
				guard = validatorTraversalGuard(guardCheck, errorAlias, marker)
			}
			lines = append(lines, emitTraversal(
				relative,
				fmt.Sprintf("%d_r%d", functionIndex, recursionIndex),
				"subject",
				"path",
				"    ",
				func(nested, nestedPath, indent string) []string {
					return []string{fmt.Sprintf("%s__ts_refinement_validate%d(%s, %s, seen);", indent, targetIndex, nested, nestedPath)}
				},
				guard,
			))
		}
		lines = append(lines, "  }")
		functions = append(functions, strings.Join(lines, "\n"))
	}
	return strings.Join(functions, "\n") +
		fmt.Sprintf("\n  const __ts_refinement_seen = Array.from({ length: %d }, () => new WeakSet<object>());", len(targetPaths)) +
		"\n  __ts_refinement_validate0(__ts_refinement_value, \"\", __ts_refinement_seen);"
}

func emitCheck(
	check analysis.Check,
	namespace, rootSubject, rootPath, rootIndent, errorAlias, marker string,
) string {
	predicates := make([]string, len(check.Definition.Predicates))
	for index, predicate := range check.Definition.Predicates {
		predicates[index] = predicate.Source
	}
	return emitTraversal(check.Path, namespace, rootSubject, rootPath, rootIndent, func(subject, path, indent string) []string {
		conditions := make([]string, len(check.Definition.Predicates))
		for index, predicate := range check.Definition.Predicates {
			conditions[index] = "(" + entailment.Compile(predicate, subject) + ")"
		}
		condition := "true"
		if len(check.Definition.Predicates) > 0 {
			condition = strings.Join(conditions, " && ")
		}
		lines := []string{fmt.Sprintf("%sif (!(%s)) {", indent, condition)}
		lines = append(lines, validatorErrorLines(check, errorAlias, marker, subject, path, indent+"  ")...)
		return append(lines, fmt.Sprintf("%s}", indent))
	}, validatorTraversalGuard(check, errorAlias, marker))
}

func validatorErrorLines(
	check analysis.Check,
	errorAlias, marker, subject, path, indent string,
) []string {
	predicates := make([]string, len(check.Definition.Predicates))
	for index, predicate := range check.Definition.Predicates {
		predicates[index] = predicate.Source
	}
	markerExpression := "undefined"
	if marker != "" {
		markerExpression = quoted(marker)
	}
	return []string{
		fmt.Sprintf("%sthrow new %s({", indent, errorAlias),
		fmt.Sprintf("%s  marker: %s,", indent, markerExpression),
		fmt.Sprintf("%s  path: %s || undefined,", indent, path),
		fmt.Sprintf("%s  predicate: %s,", indent, quoted(strings.Join(predicates, " && "))),
		fmt.Sprintf("%s  refinement: %s,", indent, quoted(check.Definition.Display)),
		fmt.Sprintf("%s  value: %s,", indent, subject),
		fmt.Sprintf("%s});", indent),
	}
}

func validatorTraversalGuard(check analysis.Check, errorAlias, marker string) traversalGuard {
	return func(subject, path string, segment analysis.PathSegment, indent string) []string {
		invalidArray := ""
		if segment.Kind == analysis.PathArray || segment.Kind == analysis.PathTuple || segment.Kind == analysis.PathTupleRest {
			invalidArray = fmt.Sprintf(" || !Array.isArray(%s)", subject)
		}
		lines := []string{fmt.Sprintf("%sif (%s === null || %s === undefined%s) {", indent, subject, subject, invalidArray)}
		lines = append(lines, validatorErrorLines(check, errorAlias, marker, subject, path, indent+"  ")...)
		return append(lines, fmt.Sprintf("%s}", indent))
	}
}

func emitTraversal(
	segments []analysis.PathSegment,
	namespace, rootSubject, rootPath, rootIndent string,
	leaf traversalLeaf,
	guard traversalGuard,
) string {
	variableIndex := 0
	var visit func(string, string, []analysis.PathSegment, string) []string
	visit = func(subject, path string, remaining []analysis.PathSegment, indent string) []string {
		if len(remaining) == 0 {
			return leaf(subject, path, indent)
		}
		segment := remaining[0]
		guardLines := []string{}
		if guard != nil {
			guardLines = guard(subject, path, segment, indent)
		}
		tail := remaining[1:]
		if segment.Kind == analysis.PathUnion {
			return append(guardLines, append(
				[]string{fmt.Sprintf("%sif (%s[%s] === %s) {", indent, subject, quoted(segment.Property), jsonValue(segment.Value))},
				append(visit(subject, path, tail, indent+"  "), indent+"}")...,
			)...)
		}

		nested := fmt.Sprintf("__ts_refinement_nested%s_%d", namespace, variableIndex)
		variableIndex++
		switch segment.Kind {
		case analysis.PathProperty:
			nestedPath := fmt.Sprintf("(%s + %s)", path, quoted(propertyPath("", segment.Name)))
			lines := append([]string{}, guardLines...)
			lines = append(lines, fmt.Sprintf("%sconst %s = %s[%s];", indent, nested, subject, quoted(segment.Name)))
			if segment.Optional {
				lines = append(lines, fmt.Sprintf("%sif (%s !== undefined) {", indent, nested))
				lines = append(lines, visit(nested, nestedPath, tail, indent+"  ")...)
				lines = append(lines, indent+"}")
			} else {
				lines = append(lines, visit(nested, nestedPath, tail, indent)...)
			}
			return lines
		case analysis.PathTuple:
			nestedPath := fmt.Sprintf("(%s + %s)", path, quoted(fmt.Sprintf("[%d]", segment.Index)))
			lines := append([]string{}, guardLines...)
			lines = append(lines, fmt.Sprintf("%sconst %s = %s[%d];", indent, nested, subject, segment.Index))
			if segment.Optional {
				lines = append(lines, fmt.Sprintf("%sif (%s !== undefined) {", indent, nested))
				lines = append(lines, visit(nested, nestedPath, tail, indent+"  ")...)
				lines = append(lines, indent+"}")
			} else {
				lines = append(lines, visit(nested, nestedPath, tail, indent)...)
			}
			return lines
		case analysis.PathIndex:
			key := fmt.Sprintf("__ts_refinement_key%s_%d", namespace, variableIndex)
			variableIndex++
			match := fmt.Sprintf("__ts_refinement_match%s_%d", namespace, variableIndex)
			variableIndex++
			pathSegment := fmt.Sprintf("__ts_refinement_path%s_%d", namespace, variableIndex)
			variableIndex++
			keys := fmt.Sprintf("__ts_refinement_keys%s_%d", namespace, variableIndex)
			inherited := fmt.Sprintf("__ts_refinement_inherited%s_%d", namespace, variableIndex)
			variableIndex++
			lines := append([]string{}, guardLines...)
			lines = append(lines,
				fmt.Sprintf("%sconst %s = new Set(Reflect.ownKeys(%s));", indent, keys, subject),
				fmt.Sprintf("%sfor (const %s in %s) %s.add(%s);", indent, inherited, subject, keys, inherited),
			)
			if segment.Key == "symbol" {
				prototype := fmt.Sprintf("__ts_refinement_prototype%s_%d", namespace, variableIndex)
				inheritedSymbol := fmt.Sprintf("__ts_refinement_inherited_symbol%s_%d", namespace, variableIndex)
				lines = append(lines,
					fmt.Sprintf("%sfor (let %s = Object.getPrototypeOf(%s); %s !== null; %s = Object.getPrototypeOf(%s)) {", indent, prototype, subject, prototype, prototype, prototype),
					fmt.Sprintf("%s  for (const %s of Object.getOwnPropertySymbols(%s)) {", indent, inheritedSymbol, prototype),
					fmt.Sprintf("%s    if (Object.prototype.propertyIsEnumerable.call(%s, %s)) %s.add(%s);", indent, prototype, inheritedSymbol, keys, inheritedSymbol),
					fmt.Sprintf("%s  }", indent),
					fmt.Sprintf("%s}", indent),
				)
			}
			lines = append(lines, fmt.Sprintf("%sfor (const %s of %s) {", indent, key, keys))
			lines = append(lines, indexKeyGuard(segment, key, match, indent+"  ")...)
			lines = append(lines,
				fmt.Sprintf("%s  const %s = %s[%s];", indent, nested, subject, key),
				fmt.Sprintf("%s  const %s = typeof %s === \"symbol\" ? \"[\" + String(%s) + \"]\" : /^[A-Za-z_$][\\w$]*$/.test(%s) ? \".\" + %s : \"[\" + JSON.stringify(%s) + \"]\";", indent, pathSegment, key, key, key, key, key),
			)
			lines = append(lines, visit(nested, fmt.Sprintf("(%s + %s)", path, pathSegment), tail, indent+"  ")...)
			return append(lines, indent+"}")
		default:
			index := fmt.Sprintf("__ts_refinement_index%s_%d", namespace, variableIndex)
			variableIndex++
			start := 0
			if segment.Kind == analysis.PathTupleRest {
				start = segment.Start
			}
			lines := append([]string{}, guardLines...)
			lines = append(lines,
				fmt.Sprintf("%sfor (let %s = %d; %s < %s.length; %s += 1) {", indent, index, start, index, subject, index),
				fmt.Sprintf("%s  const %s = %s[%s];", indent, nested, subject, index),
			)
			lines = append(lines, visit(nested, fmt.Sprintf("(%s + \"[\" + %s + \"]\")", path, index), tail, indent+"  ")...)
			return append(lines, indent+"}")
		}
	}
	return strings.Join(visit(rootSubject, rootPath, segments, rootIndent), "\n")
}

func indexKeyGuard(segment analysis.PathSegment, key, match, indent string) []string {
	switch segment.Key {
	case "number":
		return []string{fmt.Sprintf("%sif (typeof %s !== \"string\" || String(Number(%s)) !== %s) continue;", indent, key, key, key)}
	case "string":
		return []string{fmt.Sprintf("%sif (typeof %s !== \"string\") continue;", indent, key)}
	case "symbol":
		return []string{fmt.Sprintf("%sif (typeof %s !== \"symbol\") continue;", indent, key)}
	case "template":
		return templateKeyGuard(segment.Pattern, key, match, indent)
	default:
		return []string{fmt.Sprintf("%scontinue;", indent)}
	}
}

func templateKeyGuard(pattern *analysis.IndexPattern, key, match, indent string) []string {
	var source strings.Builder
	conditions := []string{}
	for index, text := range pattern.Texts {
		source.WriteString(strings.ReplaceAll(regexp.QuoteMeta(text), "/", "\\/"))
		if index >= len(pattern.Placeholders) {
			continue
		}
		source.WriteString("([\\s\\S]*?)")
		capture := fmt.Sprintf("%s[%d]", match, index+1)
		switch pattern.Placeholders[index] {
		case "number":
			conditions = append(conditions, fmt.Sprintf("%s !== \"\" && Number.isFinite(Number(%s))", capture, capture))
		case "bigint":
			conditions = append(conditions, fmt.Sprintf("/^-?(?:0|[1-9]\\d*|0[xX][\\dA-Fa-f]+|0[oO][0-7]+|0[bB][01]+)$/.test(%s)", capture))
		}
	}
	condition := ""
	if len(conditions) > 0 {
		condition = " || !(" + strings.Join(conditions, " && ") + ")"
	}
	return []string{
		fmt.Sprintf("%sif (typeof %s !== \"string\") continue;", indent, key),
		fmt.Sprintf("%sconst %s = /^%s$/u.exec(%s);", indent, match, source.String(), key),
		fmt.Sprintf("%sif (%s === null%s) continue;", indent, match, condition),
	}
}

func pathKey(path []analysis.PathSegment) string {
	encoded, _ := json.Marshal(path)
	return string(encoded)
}

func relativePath(path, prefix []analysis.PathSegment) []analysis.PathSegment {
	if len(path) < len(prefix) {
		return nil
	}
	for index := range prefix {
		left, _ := json.Marshal(path[index])
		right, _ := json.Marshal(prefix[index])
		if string(left) != string(right) {
			return nil
		}
	}
	result := make([]analysis.PathSegment, len(path)-len(prefix))
	copy(result, path[len(prefix):])
	return result
}

func jsonValue(value any) string {
	encoded, _ := json.Marshal(value)
	return string(encoded)
}
