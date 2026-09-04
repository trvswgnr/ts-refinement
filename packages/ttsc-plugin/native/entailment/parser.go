package entailment

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
	"unicode"
)

type nodeKind uint8

const (
	nodeIdentifier nodeKind = iota
	nodeNumber
	nodeBigInt
	nodeString
	nodeBoolean
	nodeNull
	nodeArray
	nodeMember
	nodeIndex
	nodeCall
	nodeFunction
	nodeUnary
	nodeBinary
	nodeConditional
	nodeOpaque
)

type sourceSpan struct {
	end       int
	shorthand string
	start     int
}

type node struct {
	kind   nodeKind
	text   string
	left   *node
	right  *node
	third  *node
	args   []*node
	params []string
	spans  []sourceSpan
}

type tokenKind uint8

const (
	tokenEOF tokenKind = iota
	tokenIdentifier
	tokenNumber
	tokenBigInt
	tokenString
	tokenOperator
	tokenLeftParen
	tokenRightParen
	tokenLeftBracket
	tokenRightBracket
	tokenDot
	tokenComma
	tokenQuestion
	tokenColon
	tokenArrow
)

type token struct {
	kind tokenKind
	text string
}

type lexer struct {
	source string
	index  int
}

func isDigitForBase(char byte, base int) bool {
	switch {
	case char >= '0' && char <= '9':
		return int(char-'0') < base
	case char >= 'a' && char <= 'f':
		return base == 16
	case char >= 'A' && char <= 'F':
		return base == 16
	default:
		return false
	}
}

func (l *lexer) number() (token, error) {
	start := l.index
	base := 10
	if l.source[l.index] == '0' && l.index+1 < len(l.source) {
		switch l.source[l.index+1] {
		case 'b', 'B':
			base = 2
		case 'o', 'O':
			base = 8
		case 'x', 'X':
			base = 16
		}
		if base != 10 {
			l.index += 2
			for l.index < len(l.source) && (isDigitForBase(l.source[l.index], base) || l.source[l.index] == '_') {
				l.index++
			}
		}
	}
	if base == 10 {
		for l.index < len(l.source) && (isDigitForBase(l.source[l.index], 10) || l.source[l.index] == '_') {
			l.index++
		}
		if l.index < len(l.source) && l.source[l.index] == '.' {
			l.index++
			for l.index < len(l.source) && (isDigitForBase(l.source[l.index], 10) || l.source[l.index] == '_') {
				l.index++
			}
		}
		if l.index < len(l.source) && (l.source[l.index] == 'e' || l.source[l.index] == 'E') {
			l.index++
			if l.index < len(l.source) && (l.source[l.index] == '+' || l.source[l.index] == '-') {
				l.index++
			}
			for l.index < len(l.source) && (isDigitForBase(l.source[l.index], 10) || l.source[l.index] == '_') {
				l.index++
			}
		}
	}
	kind := tokenNumber
	if l.index < len(l.source) && l.source[l.index] == 'n' {
		kind = tokenBigInt
		l.index++
	}
	return token{kind: kind, text: l.source[start:l.index]}, nil
}

func (l *lexer) next() (token, error) {
	for l.index < len(l.source) && unicode.IsSpace(rune(l.source[l.index])) {
		l.index++
	}
	if l.index >= len(l.source) {
		return token{kind: tokenEOF}, nil
	}
	start := l.index
	current := l.source[l.index]
	if unicode.IsLetter(rune(current)) || current == '_' || current == '$' {
		l.index++
		for l.index < len(l.source) {
			char := l.source[l.index]
			if !unicode.IsLetter(rune(char)) && !unicode.IsDigit(rune(char)) && char != '_' && char != '$' {
				break
			}
			l.index++
		}
		return token{kind: tokenIdentifier, text: l.source[start:l.index]}, nil
	}
	if unicode.IsDigit(rune(current)) {
		return l.number()
	}
	if current == '\'' || current == '"' {
		quote := current
		l.index++
		for l.index < len(l.source) && l.source[l.index] != quote {
			if l.source[l.index] == '\\' {
				l.index++
			}
			l.index++
		}
		if l.index >= len(l.source) {
			return token{}, fmt.Errorf("unterminated string")
		}
		l.index++
		value, err := strconv.Unquote(l.source[start:l.index])
		if err != nil && quote == '\'' {
			value, err = strconv.Unquote("\"" + strings.ReplaceAll(l.source[start+1:l.index-1], "\"", "\\\"") + "\"")
		}
		return token{kind: tokenString, text: value}, err
	}
	l.index++
	switch current {
	case '(':
		return token{kind: tokenLeftParen, text: "("}, nil
	case ')':
		return token{kind: tokenRightParen, text: ")"}, nil
	case '[':
		return token{kind: tokenLeftBracket, text: "["}, nil
	case ']':
		return token{kind: tokenRightBracket, text: "]"}, nil
	case '.':
		return token{kind: tokenDot, text: "."}, nil
	case ',':
		return token{kind: tokenComma, text: ","}, nil
	case '?':
		if l.index < len(l.source) && l.source[l.index] == '?' {
			l.index++
			return token{kind: tokenOperator, text: "??"}, nil
		}
		return token{kind: tokenQuestion, text: "?"}, nil
	case ':':
		return token{kind: tokenColon, text: ":"}, nil
	}
	for _, operator := range []string{"===", "!==", "=>", "&&", "||", ">=", "<=", "==", "!="} {
		if strings.HasPrefix(l.source[start:], operator) {
			l.index = start + len(operator)
			if operator == "=>" {
				return token{kind: tokenArrow, text: operator}, nil
			}
			return token{kind: tokenOperator, text: operator}, nil
		}
	}
	if strings.ContainsRune("+-*/%><!", rune(current)) {
		return token{kind: tokenOperator, text: string(current)}, nil
	}
	return token{}, fmt.Errorf("unsupported token %q", current)
}

type parser struct {
	tokens []token
	index  int
}

func parse(source string) (*node, error) {
	lex := lexer{source: source}
	tokens := make([]token, 0, 16)
	for {
		tok, err := lex.next()
		if err != nil {
			return nil, err
		}
		tokens = append(tokens, tok)
		if tok.kind == tokenEOF {
			break
		}
	}
	p := parser{tokens: tokens}
	expression, err := p.expression(0)
	if err != nil {
		return nil, err
	}
	if p.peek().kind != tokenEOF {
		return nil, fmt.Errorf("unexpected token %q", p.peek().text)
	}
	return expression, nil
}

func (p *parser) peek() token {
	if p.index >= len(p.tokens) {
		return token{kind: tokenEOF}
	}
	return p.tokens[p.index]
}

func (p *parser) take() token {
	tok := p.peek()
	p.index++
	return tok
}

func precedence(operator string) int {
	switch operator {
	case "??":
		return 1
	case "||":
		return 2
	case "&&":
		return 3
	case "===", "!==", "==", "!=", ">", ">=", "<", "<=":
		return 4
	case "+", "-":
		return 5
	case "*", "/", "%":
		return 6
	default:
		return 0
	}
}

func (p *parser) expression(minimum int) (*node, error) {
	left, err := p.prefix()
	if err != nil {
		return nil, err
	}
	for p.peek().kind == tokenOperator && precedence(p.peek().text) >= minimum {
		operator := p.take().text
		right, err := p.expression(precedence(operator) + 1)
		if err != nil {
			return nil, err
		}
		left = &node{kind: nodeBinary, text: operator, left: left, right: right}
	}
	if minimum == 0 && p.peek().kind == tokenQuestion {
		p.take()
		whenTrue, err := p.expression(0)
		if err != nil {
			return nil, err
		}
		if p.take().kind != tokenColon {
			return nil, fmt.Errorf("expected ':' in conditional expression")
		}
		whenFalse, err := p.expression(0)
		if err != nil {
			return nil, err
		}
		left = &node{kind: nodeConditional, left: left, right: whenTrue, third: whenFalse}
	}
	return left, nil
}

func (p *parser) arrowParameters() ([]string, bool) {
	start := p.index
	parameters := []string{}
	if p.peek().kind != tokenRightParen {
		for {
			parameter := p.take()
			if parameter.kind != tokenIdentifier {
				p.index = start
				return nil, false
			}
			parameters = append(parameters, parameter.text)
			if p.peek().kind != tokenComma {
				break
			}
			p.take()
		}
	}
	if p.take().kind != tokenRightParen || p.peek().kind != tokenArrow {
		p.index = start
		return nil, false
	}
	p.take()
	return parameters, true
}

func (p *parser) prefix() (*node, error) {
	tok := p.take()
	var current *node
	switch tok.kind {
	case tokenIdentifier:
		switch tok.text {
		case "true", "false":
			current = &node{kind: nodeBoolean, text: tok.text}
		case "null":
			current = &node{kind: nodeNull}
		case "typeof":
			operand, err := p.expression(7)
			if err != nil {
				return nil, err
			}
			current = &node{kind: nodeUnary, text: tok.text, left: operand}
		default:
			current = &node{kind: nodeIdentifier, text: tok.text}
			if p.peek().kind == tokenArrow {
				p.take()
				body, err := p.expression(0)
				if err != nil {
					return nil, err
				}
				current = &node{kind: nodeFunction, params: []string{tok.text}, left: body}
			}
		}
	case tokenNumber:
		current = &node{kind: nodeNumber, text: tok.text}
	case tokenBigInt:
		current = &node{kind: nodeBigInt, text: strings.TrimSuffix(tok.text, "n")}
	case tokenString:
		current = &node{kind: nodeString, text: tok.text}
	case tokenOperator:
		if tok.text != "!" && tok.text != "+" && tok.text != "-" {
			return nil, fmt.Errorf("unexpected prefix operator %q", tok.text)
		}
		operand, err := p.expression(7)
		if err != nil {
			return nil, err
		}
		current = &node{kind: nodeUnary, text: tok.text, left: operand}
	case tokenLeftParen:
		if parameters, ok := p.arrowParameters(); ok {
			body, err := p.expression(0)
			if err != nil {
				return nil, err
			}
			current = &node{kind: nodeFunction, params: parameters, left: body}
			break
		}
		expression, err := p.expression(0)
		if err != nil {
			return nil, err
		}
		if p.take().kind != tokenRightParen {
			return nil, fmt.Errorf("expected closing parenthesis")
		}
		current = expression
	case tokenLeftBracket:
		elements := []*node{}
		if p.peek().kind != tokenRightBracket {
			for {
				element, err := p.expression(0)
				if err != nil {
					return nil, err
				}
				elements = append(elements, element)
				if p.peek().kind != tokenComma {
					break
				}
				p.take()
			}
		}
		if p.take().kind != tokenRightBracket {
			return nil, fmt.Errorf("expected closing bracket")
		}
		current = &node{kind: nodeArray, args: elements}
	default:
		return nil, fmt.Errorf("unexpected token %q", tok.text)
	}

	for {
		switch p.peek().kind {
		case tokenDot:
			p.take()
			property := p.take()
			if property.kind != tokenIdentifier {
				return nil, fmt.Errorf("expected property name")
			}
			current = &node{kind: nodeMember, text: property.text, left: current}
		case tokenLeftParen:
			p.take()
			arguments := []*node{}
			if p.peek().kind != tokenRightParen {
				for {
					argument, err := p.expression(0)
					if err != nil {
						return nil, err
					}
					arguments = append(arguments, argument)
					if p.peek().kind != tokenComma {
						break
					}
					p.take()
				}
			}
			if p.take().kind != tokenRightParen {
				return nil, fmt.Errorf("expected closing parenthesis")
			}
			current = &node{kind: nodeCall, left: current, args: arguments}
		case tokenLeftBracket:
			p.take()
			index, err := p.expression(0)
			if err != nil {
				return nil, err
			}
			if p.take().kind != tokenRightBracket {
				return nil, fmt.Errorf("expected closing bracket")
			}
			current = &node{kind: nodeIndex, left: current, right: index}
		default:
			return current, nil
		}
	}
}

var standardGlobals = map[string]bool{
	"Array": true, "BigInt": true, "Boolean": true, "Infinity": true, "JSON": true,
	"Map": true, "Math": true, "NaN": true, "Number": true, "Object": true,
	"RegExp": true, "Set": true, "String": true, "Symbol": true, "WeakMap": true,
	"WeakSet": true, "isFinite": true, "isNaN": true, "parseFloat": true,
	"parseInt": true, "undefined": true,
}

var disallowedGlobals = map[string]bool{
	"AggregateError": true, "ArrayBuffer": true, "Atomics": true, "BigInt64Array": true,
	"BigUint64Array": true, "DataView": true, "Date": true, "Error": true,
	"EvalError": true, "FinalizationRegistry": true, "Float32Array": true,
	"Float64Array": true, "Function": true, "Int8Array": true, "Int16Array": true,
	"Int32Array": true, "Intl": true, "Promise": true, "Proxy": true, "RangeError": true,
	"ReferenceError": true, "Reflect": true, "SharedArrayBuffer": true, "SyntaxError": true,
	"TypeError": true, "URIError": true, "Uint8Array": true, "Uint8ClampedArray": true,
	"Uint16Array": true, "Uint32Array": true, "WeakRef": true, "WebAssembly": true,
	"decodeURI": true, "decodeURIComponent": true, "encodeURI": true,
	"encodeURIComponent": true, "escape": true, "eval": true, "globalThis": true,
	"unescape": true,
}

func normalizeSubjects(root *node, subject string) {
	localIndex := 0
	var visit func(*node, map[string]string)
	visit = func(current *node, locals map[string]string) {
		if current == nil {
			return
		}
		nestedLocals := locals
		if current.kind == nodeFunction {
			nestedLocals = make(map[string]string, len(locals)+len(current.params))
			for name, normalized := range locals {
				nestedLocals[name] = normalized
			}
			for index, name := range current.params {
				normalized := fmt.Sprintf("$local%d", localIndex)
				localIndex++
				nestedLocals[name] = normalized
				current.params[index] = normalized
			}
		}
		if current.kind == nodeIdentifier {
			if local := locals[current.text]; local != "" {
				current.text = local
			} else if current.text == subject {
				current.text = "$subject"
			}
		}
		visit(current.left, nestedLocals)
		visit(current.right, nestedLocals)
		visit(current.third, nestedLocals)
		for _, argument := range current.args {
			visit(argument, nestedLocals)
		}
	}
	visit(root, map[string]string{})
}

func validatePredicate(root *node) (string, error) {
	subjects := map[string]bool{}
	var visit func(*node, map[string]bool) error
	visit = func(current *node, locals map[string]bool) error {
		if current == nil {
			return nil
		}
		if current.kind == nodeIdentifier {
			if disallowedGlobals[current.text] {
				return fmt.Errorf("global %s is not allowed", current.text)
			}
			if !standardGlobals[current.text] && !locals[current.text] {
				subjects[current.text] = true
			}
		}
		if current.kind == nodeMember && current.text == "random" && current.left != nil && current.left.kind == nodeIdentifier && current.left.text == "Math" {
			return fmt.Errorf("global Math.random is not allowed")
		}
		nestedLocals := locals
		if current.kind == nodeFunction {
			nestedLocals = make(map[string]bool, len(locals)+len(current.params))
			for name := range locals {
				nestedLocals[name] = true
			}
			for _, parameter := range current.params {
				nestedLocals[parameter] = true
			}
		}
		if err := visit(current.left, nestedLocals); err != nil {
			return err
		}
		if err := visit(current.right, nestedLocals); err != nil {
			return err
		}
		if err := visit(current.third, nestedLocals); err != nil {
			return err
		}
		for _, argument := range current.args {
			if err := visit(argument, nestedLocals); err != nil {
				return err
			}
		}
		return nil
	}
	if err := visit(root, map[string]bool{}); err != nil {
		return "", err
	}
	if len(subjects) > 1 {
		return "", fmt.Errorf("cannot infer subject from %d identifiers", len(subjects))
	}
	for subject := range subjects {
		return subject, nil
	}
	return "", nil
}

func freeIdentifiers(root *node) []string {
	identifiers := map[string]struct{}{}
	var visit func(*node, map[string]bool)
	visit = func(current *node, locals map[string]bool) {
		if current == nil {
			return
		}
		if current.kind == nodeIdentifier && !standardGlobals[current.text] && !disallowedGlobals[current.text] && !locals[current.text] {
			identifiers[current.text] = struct{}{}
		}
		nestedLocals := locals
		if current.kind == nodeFunction {
			nestedLocals = make(map[string]bool, len(locals)+len(current.params))
			for name := range locals {
				nestedLocals[name] = true
			}
			for _, parameter := range current.params {
				nestedLocals[parameter] = true
			}
		}
		visit(current.left, nestedLocals)
		visit(current.right, nestedLocals)
		visit(current.third, nestedLocals)
		for _, argument := range current.args {
			visit(argument, nestedLocals)
		}
	}
	visit(root, map[string]bool{})
	result := make([]string, 0, len(identifiers))
	for identifier := range identifiers {
		result = append(result, identifier)
	}
	sort.Strings(result)
	return result
}

func replaceCaptures(root *node, captures map[string]*node) *node {
	var visit func(*node, map[string]bool) *node
	visit = func(current *node, locals map[string]bool) *node {
		if current == nil {
			return nil
		}
		if current.kind == nodeIdentifier && !locals[current.text] {
			if replacement := captures[current.text]; replacement != nil {
				return cloneNode(replacement)
			}
		}
		nestedLocals := locals
		if current.kind == nodeFunction {
			nestedLocals = make(map[string]bool, len(locals)+len(current.params))
			for name := range locals {
				nestedLocals[name] = true
			}
			for _, parameter := range current.params {
				nestedLocals[parameter] = true
			}
		}
		current.left = visit(current.left, nestedLocals)
		current.right = visit(current.right, nestedLocals)
		current.third = visit(current.third, nestedLocals)
		for index, argument := range current.args {
			current.args[index] = visit(argument, nestedLocals)
		}
		return current
	}
	return visit(root, map[string]bool{})
}

func cloneNode(root *node) *node {
	if root == nil {
		return nil
	}
	copy := *root
	copy.left = cloneNode(root.left)
	copy.right = cloneNode(root.right)
	copy.third = cloneNode(root.third)
	copy.args = make([]*node, len(root.args))
	for index, argument := range root.args {
		copy.args[index] = cloneNode(argument)
	}
	copy.params = append([]string(nil), root.params...)
	copy.spans = append([]sourceSpan(nil), root.spans...)
	return &copy
}

func compileOpaque(root *node, subject string) string {
	compiled := root.text
	for index := len(root.spans) - 1; index >= 0; index-- {
		span := root.spans[index]
		if span.start < 0 || span.end < span.start || span.end > len(compiled) {
			return root.text
		}
		replacement := compileNode(root.args[index], subject)
		if span.shorthand != "" {
			replacement = span.shorthand + ": " + replacement
		}
		compiled = compiled[:span.start] + replacement + compiled[span.end:]
	}
	return compiled
}

func compileNode(root *node, subject string) string {
	if root == nil {
		return ""
	}
	switch root.kind {
	case nodeIdentifier:
		if root.text == "$subject" {
			return subject
		}
		return root.text
	case nodeNumber:
		return root.text
	case nodeBigInt:
		return root.text + "n"
	case nodeString:
		return strconv.Quote(root.text)
	case nodeBoolean:
		return root.text
	case nodeNull:
		return "null"
	case nodeArray:
		elements := make([]string, len(root.args))
		for index, element := range root.args {
			elements[index] = compileNode(element, subject)
		}
		return "[" + strings.Join(elements, ", ") + "]"
	case nodeMember:
		return compileNode(root.left, subject) + "." + root.text
	case nodeIndex:
		return compileNode(root.left, subject) + "[" + compileNode(root.right, subject) + "]"
	case nodeCall:
		arguments := make([]string, len(root.args))
		for index, argument := range root.args {
			arguments[index] = compileNode(argument, subject)
		}
		return compileNode(root.left, subject) + "(" + strings.Join(arguments, ", ") + ")"
	case nodeFunction:
		return "(" + strings.Join(root.params, ", ") + ") => " + compileNode(root.left, subject)
	case nodeUnary:
		return "(" + root.text + compileNode(root.left, subject) + ")"
	case nodeBinary:
		return "(" + compileNode(root.left, subject) + " " + root.text + " " + compileNode(root.right, subject) + ")"
	case nodeConditional:
		return "(" + compileNode(root.left, subject) + " ? " + compileNode(root.right, subject) + " : " + compileNode(root.third, subject) + ")"
	case nodeOpaque:
		return compileOpaque(root, subject)
	default:
		return ""
	}
}

func canonical(root *node) string {
	if root == nil {
		return ""
	}
	switch root.kind {
	case nodeIdentifier:
		return "id:" + root.text
	case nodeNumber:
		return "number:" + root.text
	case nodeBigInt:
		return "bigint:" + root.text
	case nodeString:
		return "string:" + strconv.Quote(root.text)
	case nodeBoolean:
		return "boolean:" + root.text
	case nodeNull:
		return "null"
	case nodeArray:
		elements := make([]string, len(root.args))
		for index, element := range root.args {
			elements[index] = canonical(element)
		}
		return "array(" + strings.Join(elements, ",") + ")"
	case nodeMember:
		return "member(" + canonical(root.left) + "," + root.text + ")"
	case nodeIndex:
		return "index(" + canonical(root.left) + "," + canonical(root.right) + ")"
	case nodeCall:
		arguments := make([]string, len(root.args))
		for index, argument := range root.args {
			arguments[index] = canonical(argument)
		}
		return "call(" + canonical(root.left) + "," + strings.Join(arguments, ",") + ")"
	case nodeFunction:
		return "function(" + strings.Join(root.params, ",") + "," + canonical(root.left) + ")"
	case nodeUnary:
		return "unary(" + root.text + "," + canonical(root.left) + ")"
	case nodeBinary:
		return "binary(" + root.text + "," + canonical(root.left) + "," + canonical(root.right) + ")"
	case nodeConditional:
		return "conditional(" + canonical(root.left) + "," + canonical(root.right) + "," + canonical(root.third) + ")"
	case nodeOpaque:
		return "opaque:" + compileOpaque(root, "$subject")
	default:
		return ""
	}
}
