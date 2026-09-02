package entailment

import (
	"fmt"
	"math/big"
)

type Facts struct {
	SubjectLength bool `json:"subjectLength,omitempty"`
}

type Predicate struct {
	Source string
	root   *node
	key    string
}

func (predicate Predicate) Key() string {
	return predicate.key
}

func ParsePredicate(source string) (Predicate, error) {
	root, err := parse(source)
	if err != nil {
		return Predicate{}, err
	}
	if err := validatePredicate(root); err != nil {
		return Predicate{}, err
	}
	normalizeSubjects(root)
	return Predicate{Source: source, root: root, key: canonical(root)}, nil
}

func Compile(predicate Predicate, subject string) string {
	return compileNode(predicate.root, subject)
}

type scalarKind uint8

const (
	scalarNumber scalarKind = iota
	scalarBigInt
)

type scalar struct {
	kind  scalarKind
	value *big.Rat
}

type bound struct {
	inclusive bool
	value     scalar
}

type domain struct {
	finite      bool
	integral    bool
	lower       *bound
	upper       *bound
	congruences []congruence
}

type comparison struct {
	term             string
	kind             scalarKind
	relation         string
	bound            bound
	requiresIntegral bool
}

type congruence struct {
	term      string
	kind      scalarKind
	modulus   *big.Int
	remainder *big.Int
}

type affine struct {
	term        string
	coefficient *big.Rat
	offset      *big.Rat
	transformed bool
}

func rat(value int64) *big.Rat {
	return new(big.Rat).SetInt64(value)
}

func clone(value *big.Rat) *big.Rat {
	return new(big.Rat).Set(value)
}

func scalarLiteral(expression *node) (scalar, bool) {
	negative := false
	current := expression
	if current != nil && current.kind == nodeUnary && current.text == "-" {
		negative = true
		current = current.left
	}
	if current == nil || (current.kind != nodeNumber && current.kind != nodeBigInt) {
		return scalar{}, false
	}
	value := new(big.Rat)
	if _, ok := value.SetString(current.text); !ok {
		return scalar{}, false
	}
	if negative {
		value.Neg(value)
	}
	kind := scalarNumber
	if current.kind == nodeBigInt {
		kind = scalarBigInt
	}
	return scalar{kind: kind, value: value}, true
}

func term(expression *node) (string, bool) {
	if expression == nil {
		return "", false
	}
	if expression.kind == nodeIdentifier && expression.text == "$subject" {
		return "subject", true
	}
	if expression.kind == nodeMember && expression.text == "length" {
		if parent, ok := term(expression.left); ok && parent == "subject" {
			return "subject.length", true
		}
	}
	return "", false
}

func parseAffine(expression *node, kind scalarKind) (affine, bool) {
	if name, ok := term(expression); ok {
		return affine{term: name, coefficient: rat(1), offset: rat(0)}, true
	}
	if literal, ok := scalarLiteral(expression); ok && literal.kind == kind {
		return affine{coefficient: rat(0), offset: clone(literal.value)}, true
	}
	if expression == nil {
		return affine{}, false
	}
	if expression.kind == nodeUnary && (expression.text == "+" || expression.text == "-") {
		operand, ok := parseAffine(expression.left, kind)
		if !ok {
			return affine{}, false
		}
		operand.transformed = true
		if expression.text == "-" {
			operand.coefficient.Neg(operand.coefficient)
			operand.offset.Neg(operand.offset)
		}
		return operand, true
	}
	if expression.kind != nodeBinary || (expression.text != "+" && expression.text != "-" && expression.text != "*") {
		return affine{}, false
	}
	left, leftOK := parseAffine(expression.left, kind)
	right, rightOK := parseAffine(expression.right, kind)
	if !leftOK || !rightOK {
		return affine{}, false
	}
	if left.term != "" && right.term != "" && left.term != right.term {
		return affine{}, false
	}
	if expression.text == "*" {
		if left.term != "" && right.term != "" {
			return affine{}, false
		}
		constant := left
		value := right
		if left.term != "" {
			constant, value = right, left
		}
		if constant.term != "" {
			return affine{}, false
		}
		return affine{
			term:        value.term,
			coefficient: new(big.Rat).Mul(value.coefficient, constant.offset),
			offset:      new(big.Rat).Mul(value.offset, constant.offset),
			transformed: true,
		}, true
	}
	sign := int64(1)
	if expression.text == "-" {
		sign = -1
	}
	return affine{
		term:        first(left.term, right.term),
		coefficient: new(big.Rat).Add(left.coefficient, new(big.Rat).Mul(rat(sign), right.coefficient)),
		offset:      new(big.Rat).Add(left.offset, new(big.Rat).Mul(rat(sign), right.offset)),
		transformed: true,
	}, true
}

func first(left, right string) string {
	if left != "" {
		return left
	}
	return right
}

func reverse(operator string) string {
	switch operator {
	case ">":
		return "<"
	case ">=":
		return "<="
	case "<":
		return ">"
	case "<=":
		return ">="
	default:
		return operator
	}
}

func negate(operator string) (string, bool) {
	switch operator {
	case ">":
		return "<=", true
	case ">=":
		return "<", true
	case "<":
		return ">=", true
	case "<=":
		return ">", true
	case "!==", "!=":
		return "===", true
	default:
		return "", false
	}
}

func parseComparison(expression *node) (comparison, bool) {
	current := expression
	negated := false
	if current != nil && current.kind == nodeUnary && current.text == "!" {
		negated = true
		current = current.left
	}
	if current == nil || current.kind != nodeBinary {
		return comparison{}, false
	}
	operator := current.text
	if negated {
		var ok bool
		operator, ok = negate(operator)
		if !ok {
			return comparison{}, false
		}
	}
	if operator == "==" {
		operator = "==="
	}
	if operator != ">" && operator != ">=" && operator != "<" && operator != "<=" && operator != "===" {
		return comparison{}, false
	}
	literal, ok := scalarLiteral(current.right)
	affineExpression := current.left
	if !ok {
		literal, ok = scalarLiteral(current.left)
		if !ok {
			return comparison{}, false
		}
		affineExpression = current.right
		operator = reverse(operator)
	}
	value, ok := parseAffine(affineExpression, literal.kind)
	if !ok || value.term == "" || value.coefficient.Sign() == 0 {
		return comparison{}, false
	}
	if value.coefficient.Sign() < 0 {
		value.coefficient.Neg(value.coefficient)
		value.offset.Neg(value.offset)
		literal.value.Neg(literal.value)
		operator = reverse(operator)
	}
	limit := new(big.Rat).Quo(new(big.Rat).Sub(literal.value, value.offset), value.coefficient)
	relation := ""
	inclusive := false
	switch operator {
	case ">", ">=":
		relation = "lower"
		inclusive = operator == ">="
	case "<", "<=":
		relation = "upper"
		inclusive = operator == "<="
	case "===":
		relation = "equal"
		inclusive = true
	}
	requiresIntegral := value.transformed && literal.kind == scalarNumber
	return comparison{
		term:             value.term,
		kind:             literal.kind,
		relation:         relation,
		bound:            bound{inclusive: inclusive, value: scalar{kind: literal.kind, value: limit}},
		requiresIntegral: requiresIntegral,
	}, true
}

func typeFact(expression *node) (string, string, bool) {
	if expression == nil || expression.kind != nodeCall || len(expression.args) != 1 {
		return "", "", false
	}
	callee := expression.left
	if callee == nil || callee.kind != nodeMember || callee.left == nil || callee.left.kind != nodeIdentifier || callee.left.text != "Number" {
		return "", "", false
	}
	name, ok := term(expression.args[0])
	if !ok || (callee.text != "isInteger" && callee.text != "isFinite") {
		return "", "", false
	}
	return name, callee.text, true
}

func parseCongruence(expression *node) (congruence, bool) {
	if expression == nil || expression.kind != nodeBinary || (expression.text != "===" && expression.text != "==") {
		return congruence{}, false
	}
	moduloExpression := expression.left
	remainder, ok := scalarLiteral(expression.right)
	if !ok {
		moduloExpression = expression.right
		remainder, ok = scalarLiteral(expression.left)
	}
	if !ok || moduloExpression == nil || moduloExpression.kind != nodeBinary || moduloExpression.text != "%" {
		return congruence{}, false
	}
	modulus, ok := scalarLiteral(moduloExpression.right)
	name, termOK := term(moduloExpression.left)
	if !ok || !termOK || modulus.kind != remainder.kind || !modulus.value.IsInt() || !remainder.value.IsInt() {
		return congruence{}, false
	}
	modulusInt := new(big.Int).Abs(modulus.value.Num())
	if modulusInt.Sign() == 0 || new(big.Int).Abs(remainder.value.Num()).Cmp(modulusInt) >= 0 {
		return congruence{}, false
	}
	return congruence{term: name, kind: modulus.kind, modulus: modulusInt, remainder: new(big.Int).Set(remainder.value.Num())}, true
}

func flatten(expression *node) []*node {
	if expression != nil && expression.kind == nodeBinary && expression.text == "&&" {
		return append(flatten(expression.left), flatten(expression.right)...)
	}
	return []*node{expression}
}

func domainKey(kind scalarKind, term string) string {
	return fmt.Sprintf("%d:%s", kind, term)
}

func strongerLower(current *bound, next bound) *bound {
	if current == nil || current.value.value.Cmp(next.value.value) < 0 {
		copy := next
		return &copy
	}
	if current.value.value.Cmp(next.value.value) > 0 {
		return current
	}
	current.inclusive = current.inclusive && next.inclusive
	return current
}

func strongerUpper(current *bound, next bound) *bound {
	if current == nil || current.value.value.Cmp(next.value.value) > 0 {
		copy := next
		return &copy
	}
	if current.value.value.Cmp(next.value.value) < 0 {
		return current
	}
	current.inclusive = current.inclusive && next.inclusive
	return current
}

func addComparison(target *domain, fact comparison) {
	if fact.relation == "lower" || fact.relation == "equal" {
		target.lower = strongerLower(target.lower, fact.bound)
	}
	if fact.relation == "upper" || fact.relation == "equal" {
		target.upper = strongerUpper(target.upper, fact.bound)
	}
}

func normalizeIntegralBounds(target *domain) {
	if !target.integral {
		return
	}
	if target.lower != nil && !target.lower.inclusive {
		floor := new(big.Int).Quo(target.lower.value.value.Num(), target.lower.value.value.Denom())
		if target.lower.value.value.Sign() < 0 && new(big.Int).Mod(target.lower.value.value.Num(), target.lower.value.value.Denom()).Sign() != 0 {
			floor.Sub(floor, big.NewInt(1))
		}
		floor.Add(floor, big.NewInt(1))
		target.lower = &bound{inclusive: true, value: scalar{kind: target.lower.value.kind, value: new(big.Rat).SetInt(floor)}}
	}
	if target.upper != nil && !target.upper.inclusive {
		quotient := new(big.Int).Quo(target.upper.value.value.Num(), target.upper.value.value.Denom())
		if target.upper.value.value.Sign() > 0 && new(big.Int).Mod(target.upper.value.value.Num(), target.upper.value.value.Denom()).Sign() != 0 {
			quotient.Add(quotient, big.NewInt(1))
		}
		quotient.Sub(quotient, big.NewInt(1))
		target.upper = &bound{inclusive: true, value: scalar{kind: target.upper.value.kind, value: new(big.Rat).SetInt(quotient)}}
	}
}

func lowerEntails(source *bound, target bound) bool {
	if source == nil {
		return false
	}
	order := source.value.value.Cmp(target.value.value)
	return order > 0 || (order == 0 && (target.inclusive || !source.inclusive))
}

func upperEntails(source *bound, target bound) bool {
	if source == nil {
		return false
	}
	order := source.value.value.Cmp(target.value.value)
	return order < 0 || (order == 0 && (target.inclusive || !source.inclusive))
}

func modulo(value, modulus *big.Int) *big.Int {
	result := new(big.Int).Mod(value, modulus)
	if result.Sign() < 0 {
		result.Add(result, modulus)
	}
	return result
}

func congruenceEntails(source *domain, target congruence) bool {
	for _, fact := range source.congruences {
		if new(big.Int).Mod(fact.modulus, target.modulus).Sign() != 0 {
			continue
		}
		if modulo(fact.remainder, target.modulus).Cmp(modulo(target.remainder, target.modulus)) == 0 {
			return true
		}
	}
	return false
}

func Entails(source, target []Predicate, facts Facts) bool {
	sourceAtoms := make([]*node, 0, len(source))
	exact := map[string]bool{}
	for _, predicate := range source {
		atoms := flatten(predicate.root)
		sourceAtoms = append(sourceAtoms, atoms...)
		for _, atom := range atoms {
			exact[canonical(atom)] = true
		}
	}
	domains := map[string]*domain{}
	getDomain := func(kind scalarKind, term string) *domain {
		key := domainKey(kind, term)
		if domains[key] == nil {
			domains[key] = &domain{integral: kind == scalarBigInt}
		}
		return domains[key]
	}
	if facts.SubjectLength {
		length := getDomain(scalarNumber, "subject.length")
		length.finite = true
		length.integral = true
		length.lower = &bound{inclusive: true, value: scalar{kind: scalarNumber, value: rat(0)}}
	}
	for _, atom := range sourceAtoms {
		if name, fact, ok := typeFact(atom); ok {
			target := getDomain(scalarNumber, name)
			target.finite = true
			if fact == "isInteger" {
				target.integral = true
			}
		}
	}
	for _, atom := range sourceAtoms {
		fact, ok := parseComparison(atom)
		if !ok {
			continue
		}
		target := getDomain(fact.kind, fact.term)
		if fact.requiresIntegral && !target.integral {
			continue
		}
		addComparison(target, fact)
	}
	for _, atom := range sourceAtoms {
		fact, ok := parseCongruence(atom)
		if !ok {
			continue
		}
		target := getDomain(fact.kind, fact.term)
		if fact.kind == scalarNumber && !target.integral {
			continue
		}
		target.congruences = append(target.congruences, fact)
	}
	for _, target := range domains {
		normalizeIntegralBounds(target)
		if target.lower != nil && target.upper != nil {
			target.finite = true
		}
	}

	for _, predicate := range target {
		for _, atom := range flatten(predicate.root) {
			if exact[canonical(atom)] || (atom.kind == nodeBoolean && atom.text == "true") {
				continue
			}
			if name, fact, ok := typeFact(atom); ok {
				domain := getDomain(scalarNumber, name)
				if (fact == "isInteger" && domain.integral) || (fact == "isFinite" && domain.finite) {
					continue
				}
				return false
			}
			if requested, ok := parseComparison(atom); ok {
				domain := getDomain(requested.kind, requested.term)
				if requested.requiresIntegral && !domain.integral {
					return false
				}
				switch requested.relation {
				case "lower":
					if lowerEntails(domain.lower, requested.bound) {
						continue
					}
				case "upper":
					if upperEntails(domain.upper, requested.bound) {
						continue
					}
				case "equal":
					if lowerEntails(domain.lower, requested.bound) && upperEntails(domain.upper, requested.bound) {
						continue
					}
				}
				return false
			}
			if requested, ok := parseCongruence(atom); ok {
				domain := getDomain(requested.kind, requested.term)
				if (requested.kind == scalarBigInt || domain.integral) && congruenceEntails(domain, requested) {
					continue
				}
				return false
			}
			return false
		}
	}
	return true
}

func ParsePredicates(sources []string) ([]Predicate, error) {
	predicates := make([]Predicate, len(sources))
	for index, source := range sources {
		predicate, err := ParsePredicate(source)
		if err != nil {
			return nil, fmt.Errorf("predicate %q: %w", source, err)
		}
		predicates[index] = predicate
	}
	return predicates, nil
}
