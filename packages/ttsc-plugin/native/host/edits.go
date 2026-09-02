package host

import (
	"fmt"
	"sort"
	"strings"
)

type insertionKind uint8

const (
	insertionImport insertionKind = iota
	insertionPrefix
	insertionSuffix
)

type insertion struct {
	kind      insertionKind
	nodeEnd   int
	nodeStart int
	text      string
}

type textRange struct {
	end   int
	start int
}

type editPlan struct {
	insertions map[int][]insertion
	removals   []textRange
}

func newEditPlan() *editPlan {
	return &editPlan{insertions: map[int][]insertion{}}
}

func (plan *editPlan) insert(position int, value insertion) {
	plan.insertions[position] = append(plan.insertions[position], value)
}

func (plan *editPlan) remove(start, end int) {
	plan.removals = append(plan.removals, textRange{start: start, end: end})
}

func (plan *editPlan) apply(source string) (string, error) {
	removals := append([]textRange(nil), plan.removals...)
	sort.Slice(removals, func(left, right int) bool {
		return removals[left].start < removals[right].start
	})
	for index, removal := range removals {
		if removal.start < 0 || removal.end < removal.start || removal.end > len(source) {
			return "", fmt.Errorf("invalid source removal [%d, %d)", removal.start, removal.end)
		}
		if index > 0 && removal.start < removals[index-1].end {
			return "", fmt.Errorf("overlapping source removals at %d", removal.start)
		}
	}
	for position := range plan.insertions {
		if position < 0 || position > len(source) {
			return "", fmt.Errorf("invalid source insertion at %d", position)
		}
		for _, removal := range removals {
			if removal.start < position && position < removal.end {
				return "", fmt.Errorf("source insertion at %d falls inside a removal", position)
			}
		}
	}

	var output strings.Builder
	output.Grow(len(source))
	removalIndex := 0
	for position := 0; position <= len(source); {
		if values := plan.insertions[position]; len(values) > 0 {
			sort.SliceStable(values, func(left, right int) bool {
				if values[left].kind != values[right].kind {
					return values[left].kind < values[right].kind
				}
				if values[left].kind == insertionPrefix {
					if values[left].nodeStart != values[right].nodeStart {
						return values[left].nodeStart < values[right].nodeStart
					}
					return values[left].nodeEnd > values[right].nodeEnd
				}
				if values[left].kind == insertionSuffix {
					if values[left].nodeStart != values[right].nodeStart {
						return values[left].nodeStart > values[right].nodeStart
					}
					return values[left].nodeEnd < values[right].nodeEnd
				}
				return false
			})
			for _, value := range values {
				output.WriteString(value.text)
			}
		}
		if position == len(source) {
			break
		}
		if removalIndex < len(removals) && removals[removalIndex].start == position {
			position = removals[removalIndex].end
			removalIndex++
			continue
		}
		output.WriteByte(source[position])
		position++
	}
	return output.String(), nil
}
