package entailment

import (
	"fmt"
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
	nodeMember
	nodeCall
	nodeUnary
	nodeBinary
)

type node struct {
	kind  nodeKind
	text  string
	left  *node
	right *node
	args  []*node
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
	tokenDot
	tokenComma
)

type token struct {
	kind tokenKind
	text string
}

type lexer struct {
	source string
	index  int
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
		l.index++
		for l.index < len(l.source) && (unicode.IsDigit(rune(l.source[l.index])) || l.source[l.index] == '.') {
			l.index++
		}
		kind := tokenNumber
		if l.index < len(l.source) && l.source[l.index] == 'n' {
			kind = tokenBigInt
			l.index++
		}
		return token{kind: kind, text: l.source[start:l.index]}, nil
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
	case '.':
		return token{kind: tokenDot, text: "."}, nil
	case ',':
		return token{kind: tokenComma, text: ","}, nil
	}
	for _, operator := range []string{"===", "!==", "&&", "||", ">=", "<=", "==", "!="} {
		if strings.HasPrefix(l.source[start:], operator) {
			l.index = start + len(operator)
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
	case "||":
		return 1
	case "&&":
		return 2
	case "===", "!==", "==", "!=", ">", ">=", "<", "<=":
		return 3
	case "+", "-":
		return 4
	case "*", "/", "%":
		return 5
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
	return left, nil
}

func (p *parser) prefix() (*node, error) {
	tok := p.take()
	var current *node
	switch tok.kind {
	case tokenIdentifier:
		switch tok.text {
		case "true", "false":
			current = &node{kind: nodeBoolean, text: tok.text}
		default:
			current = &node{kind: nodeIdentifier, text: tok.text}
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
		operand, err := p.expression(6)
		if err != nil {
			return nil, err
		}
		current = &node{kind: nodeUnary, text: tok.text, left: operand}
	case tokenLeftParen:
		expression, err := p.expression(0)
		if err != nil {
			return nil, err
		}
		if p.take().kind != tokenRightParen {
			return nil, fmt.Errorf("expected closing parenthesis")
		}
		current = expression
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
		default:
			return current, nil
		}
	}
}

func normalizeSubjects(root *node) {
	globals := map[string]bool{
		"Array": true, "Math": true, "Number": true, "Infinity": true, "NaN": true, "undefined": true,
	}
	var visit func(*node)
	visit = func(current *node) {
		if current == nil {
			return
		}
		if current.kind == nodeIdentifier && !globals[current.text] {
			current.text = "$subject"
		}
		visit(current.left)
		visit(current.right)
		for _, argument := range current.args {
			visit(argument)
		}
	}
	visit(root)
}

func validatePredicate(root *node) error {
	globals := map[string]bool{
		"Array": true, "Math": true, "Number": true, "Infinity": true, "NaN": true, "undefined": true,
	}
	subjects := map[string]bool{}
	var visit func(*node) error
	visit = func(current *node) error {
		if current == nil {
			return nil
		}
		if current.kind == nodeIdentifier {
			if current.text == "Date" {
				return fmt.Errorf("global Date is not allowed")
			}
			if !globals[current.text] {
				subjects[current.text] = true
			}
		}
		if current.kind == nodeMember && current.text == "random" && current.left != nil && current.left.kind == nodeIdentifier && current.left.text == "Math" {
			return fmt.Errorf("global Math.random is not allowed")
		}
		if err := visit(current.left); err != nil {
			return err
		}
		if err := visit(current.right); err != nil {
			return err
		}
		for _, argument := range current.args {
			if err := visit(argument); err != nil {
				return err
			}
		}
		return nil
	}
	if err := visit(root); err != nil {
		return err
	}
	if len(subjects) > 1 {
		return fmt.Errorf("cannot infer subject from %d identifiers", len(subjects))
	}
	return nil
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
	case nodeMember:
		return compileNode(root.left, subject) + "." + root.text
	case nodeCall:
		arguments := make([]string, len(root.args))
		for index, argument := range root.args {
			arguments[index] = compileNode(argument, subject)
		}
		return compileNode(root.left, subject) + "(" + strings.Join(arguments, ", ") + ")"
	case nodeUnary:
		return "(" + root.text + compileNode(root.left, subject) + ")"
	case nodeBinary:
		return "(" + compileNode(root.left, subject) + " " + root.text + " " + compileNode(root.right, subject) + ")"
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
	case nodeMember:
		return "member(" + canonical(root.left) + "," + root.text + ")"
	case nodeCall:
		arguments := make([]string, len(root.args))
		for index, argument := range root.args {
			arguments[index] = canonical(argument)
		}
		return "call(" + canonical(root.left) + "," + strings.Join(arguments, ",") + ")"
	case nodeUnary:
		return "unary(" + root.text + "," + canonical(root.left) + ")"
	case nodeBinary:
		return "binary(" + root.text + "," + canonical(root.left) + "," + canonical(root.right) + ")"
	default:
		return ""
	}
}
