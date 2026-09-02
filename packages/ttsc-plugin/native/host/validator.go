package host

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/ts-refinement/ttsc-plugin/native/analysis"
	"github.com/ts-refinement/ttsc-plugin/native/entailment"
)

type traversalLeaf func(subject, path, indent string) []string

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
			lines = append(lines, emitTraversal(
				relative,
				fmt.Sprintf("%d_r%d", functionIndex, recursionIndex),
				"subject",
				"path",
				"    ",
				func(nested, nestedPath, indent string) []string {
					return []string{fmt.Sprintf("%s__ts_refinement_validate%d(%s, %s, seen);", indent, targetIndex, nested, nestedPath)}
				},
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
	return emitTraversal(check.Path, namespace, rootSubject, rootPath, rootIndent, func(subject, path, indent string) []string {
		conditions := make([]string, len(check.Definition.Predicates))
		predicates := make([]string, len(check.Definition.Predicates))
		for index, predicate := range check.Definition.Predicates {
			conditions[index] = "(" + entailment.Compile(predicate, subject) + ")"
			predicates[index] = predicate.Source
		}
		condition := "true"
		if len(check.Definition.Predicates) > 0 {
			condition = strings.Join(conditions, " && ")
		}
		markerExpression := "undefined"
		if marker != "" {
			markerExpression = quoted(marker)
		}
		return []string{
			fmt.Sprintf("%sif (!(%s)) {", indent, condition),
			fmt.Sprintf("%s  throw new %s({", indent, errorAlias),
			fmt.Sprintf("%s    marker: %s,", indent, markerExpression),
			fmt.Sprintf("%s    path: %s || undefined,", indent, path),
			fmt.Sprintf("%s    predicate: %s,", indent, quoted(strings.Join(predicates, " && "))),
			fmt.Sprintf("%s    refinement: %s,", indent, quoted(check.Definition.Display)),
			fmt.Sprintf("%s    value: %s,", indent, subject),
			fmt.Sprintf("%s  });", indent),
			fmt.Sprintf("%s}", indent),
		}
	})
}

func emitTraversal(
	segments []analysis.PathSegment,
	namespace, rootSubject, rootPath, rootIndent string,
	leaf traversalLeaf,
) string {
	variableIndex := 0
	var visit func(string, string, []analysis.PathSegment, string) []string
	visit = func(subject, path string, remaining []analysis.PathSegment, indent string) []string {
		if len(remaining) == 0 {
			return leaf(subject, path, indent)
		}
		segment := remaining[0]
		tail := remaining[1:]
		if segment.Kind == analysis.PathUnion {
			return append(
				[]string{fmt.Sprintf("%sif (%s[%s] === %s) {", indent, subject, quoted(segment.Property), jsonValue(segment.Value))},
				append(visit(subject, path, tail, indent+"  "), indent+"}")...,
			)
		}

		nested := fmt.Sprintf("__ts_refinement_nested%s_%d", namespace, variableIndex)
		variableIndex++
		switch segment.Kind {
		case analysis.PathProperty:
			nestedPath := fmt.Sprintf("(%s + %s)", path, quoted(propertyPath("", segment.Name)))
			lines := []string{fmt.Sprintf("%sconst %s = %s[%s];", indent, nested, subject, quoted(segment.Name))}
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
			lines := []string{fmt.Sprintf("%sconst %s = %s[%d];", indent, nested, subject, segment.Index)}
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
			pathSegment := fmt.Sprintf("__ts_refinement_path%s_%d", namespace, variableIndex)
			variableIndex++
			lines := []string{fmt.Sprintf("%sfor (const %s of Object.keys(%s)) {", indent, key, subject)}
			if segment.Key == "number" {
				lines = append(lines, fmt.Sprintf("%s  if (!/^(?:0|[1-9]\\d*)$/.test(%s)) continue;", indent, key))
			}
			lines = append(lines,
				fmt.Sprintf("%s  const %s = %s[%s];", indent, nested, subject, key),
				fmt.Sprintf("%s  const %s = /^[A-Za-z_$][\\w$]*$/.test(%s) ? \".\" + %s : \"[\" + JSON.stringify(%s) + \"]\";", indent, pathSegment, key, key, key),
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
			lines := []string{
				fmt.Sprintf("%sfor (let %s = %d; %s < %s.length; %s += 1) {", indent, index, start, index, subject, index),
				fmt.Sprintf("%s  const %s = %s[%s];", indent, nested, subject, index),
			}
			lines = append(lines, visit(nested, fmt.Sprintf("(%s + \"[\" + %s + \"]\")", path, index), tail, indent+"  ")...)
			return append(lines, indent+"}")
		}
	}
	return strings.Join(visit(rootSubject, rootPath, segments, rootIndent), "\n")
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
