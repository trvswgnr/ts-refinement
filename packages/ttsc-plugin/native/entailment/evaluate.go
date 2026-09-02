package entailment

import (
	"math"
	"math/big"
)

type runtimeKind uint8

const (
	runtimeUnknown runtimeKind = iota
	runtimeNumber
	runtimeBigInt
	runtimeString
	runtimeBoolean
)

type runtimeValue struct {
	kind    runtimeKind
	number  float64
	bigint  *big.Int
	text    string
	boolean bool
}

func Evaluate(predicate Predicate, source string) (bool, bool) {
	expression, err := parse(source)
	if err != nil {
		return false, false
	}
	value, ok := evaluateNode(expression, runtimeValue{})
	if !ok {
		return false, false
	}
	result, ok := evaluateNode(predicate.root, value)
	return result.boolean, ok && result.kind == runtimeBoolean
}

func evaluateNode(expression *node, subject runtimeValue) (runtimeValue, bool) {
	if expression == nil {
		return runtimeValue{}, false
	}
	switch expression.kind {
	case nodeIdentifier:
		if expression.text == "$subject" {
			return subject, subject.kind != runtimeUnknown
		}
		return runtimeValue{}, false
	case nodeNumber:
		value, ok := new(big.Rat).SetString(expression.text)
		if !ok {
			return runtimeValue{}, false
		}
		number, _ := value.Float64()
		return runtimeValue{kind: runtimeNumber, number: number}, true
	case nodeBigInt:
		value, ok := new(big.Int).SetString(expression.text, 10)
		return runtimeValue{kind: runtimeBigInt, bigint: value}, ok
	case nodeString:
		return runtimeValue{kind: runtimeString, text: expression.text}, true
	case nodeBoolean:
		return runtimeValue{kind: runtimeBoolean, boolean: expression.text == "true"}, true
	case nodeUnary:
		operand, ok := evaluateNode(expression.left, subject)
		if !ok {
			return runtimeValue{}, false
		}
		switch expression.text {
		case "!":
			truth, ok := truthy(operand)
			return runtimeValue{kind: runtimeBoolean, boolean: !truth}, ok
		case "+":
			return operand, operand.kind == runtimeNumber
		case "-":
			if operand.kind == runtimeNumber {
				operand.number = -operand.number
				return operand, true
			}
			if operand.kind == runtimeBigInt {
				operand.bigint = new(big.Int).Neg(operand.bigint)
				return operand, true
			}
		}
		return runtimeValue{}, false
	case nodeMember:
		object, ok := evaluateNode(expression.left, subject)
		if !ok || expression.text != "length" || object.kind != runtimeString {
			return runtimeValue{}, false
		}
		return runtimeValue{kind: runtimeNumber, number: float64(len(object.text))}, true
	case nodeCall:
		return evaluateCall(expression, subject)
	case nodeBinary:
		return evaluateBinary(expression, subject)
	default:
		return runtimeValue{}, false
	}
}

func truthy(value runtimeValue) (bool, bool) {
	switch value.kind {
	case runtimeBoolean:
		return value.boolean, true
	case runtimeNumber:
		return value.number != 0 && !math.IsNaN(value.number), true
	case runtimeBigInt:
		return value.bigint.Sign() != 0, true
	case runtimeString:
		return value.text != "", true
	default:
		return false, false
	}
}

func evaluateCall(expression *node, subject runtimeValue) (runtimeValue, bool) {
	callee := expression.left
	if callee == nil || callee.kind != nodeMember || callee.left == nil || callee.left.kind != nodeIdentifier || len(expression.args) != 1 {
		return runtimeValue{}, false
	}
	argument, ok := evaluateNode(expression.args[0], subject)
	if !ok {
		return runtimeValue{}, false
	}
	if callee.left.text == "Number" {
		switch callee.text {
		case "isFinite":
			return runtimeValue{kind: runtimeBoolean, boolean: argument.kind == runtimeNumber && !math.IsNaN(argument.number) && !math.IsInf(argument.number, 0)}, true
		case "isInteger":
			return runtimeValue{kind: runtimeBoolean, boolean: argument.kind == runtimeNumber && !math.IsNaN(argument.number) && !math.IsInf(argument.number, 0) && math.Trunc(argument.number) == argument.number}, true
		}
	}
	if callee.left.text == "Math" && callee.text == "abs" && argument.kind == runtimeNumber {
		argument.number = math.Abs(argument.number)
		return argument, true
	}
	return runtimeValue{}, false
}

func evaluateBinary(expression *node, subject runtimeValue) (runtimeValue, bool) {
	left, ok := evaluateNode(expression.left, subject)
	if !ok {
		return runtimeValue{}, false
	}
	if expression.text == "&&" || expression.text == "||" {
		leftTruthy, ok := truthy(left)
		if !ok {
			return runtimeValue{}, false
		}
		if expression.text == "&&" && !leftTruthy || expression.text == "||" && leftTruthy {
			return runtimeValue{kind: runtimeBoolean, boolean: leftTruthy}, true
		}
		return evaluateNode(expression.right, subject)
	}
	right, ok := evaluateNode(expression.right, subject)
	if !ok || left.kind != right.kind {
		return runtimeValue{}, false
	}
	if expression.text == "===" || expression.text == "==" || expression.text == "!==" || expression.text == "!=" {
		equal := runtimeEqual(left, right)
		if expression.text == "!==" || expression.text == "!=" {
			equal = !equal
		}
		return runtimeValue{kind: runtimeBoolean, boolean: equal}, true
	}
	if expression.text == ">" || expression.text == ">=" || expression.text == "<" || expression.text == "<=" {
		order, ok := runtimeCompare(left, right)
		if !ok {
			return runtimeValue{}, false
		}
		result := expression.text == ">" && order > 0 || expression.text == ">=" && order >= 0 || expression.text == "<" && order < 0 || expression.text == "<=" && order <= 0
		return runtimeValue{kind: runtimeBoolean, boolean: result}, true
	}
	return runtimeArithmetic(left, right, expression.text)
}

func runtimeEqual(left, right runtimeValue) bool {
	switch left.kind {
	case runtimeNumber:
		return left.number == right.number
	case runtimeBigInt:
		return left.bigint.Cmp(right.bigint) == 0
	case runtimeString:
		return left.text == right.text
	case runtimeBoolean:
		return left.boolean == right.boolean
	default:
		return false
	}
}

func runtimeCompare(left, right runtimeValue) (int, bool) {
	switch left.kind {
	case runtimeNumber:
		if math.IsNaN(left.number) || math.IsNaN(right.number) {
			return 0, false
		}
		if left.number < right.number {
			return -1, true
		}
		if left.number > right.number {
			return 1, true
		}
		return 0, true
	case runtimeBigInt:
		return left.bigint.Cmp(right.bigint), true
	case runtimeString:
		if left.text < right.text {
			return -1, true
		}
		if left.text > right.text {
			return 1, true
		}
		return 0, true
	default:
		return 0, false
	}
}

func runtimeArithmetic(left, right runtimeValue, operator string) (runtimeValue, bool) {
	if left.kind == runtimeNumber {
		switch operator {
		case "+":
			left.number += right.number
		case "-":
			left.number -= right.number
		case "*":
			left.number *= right.number
		case "/":
			left.number /= right.number
		case "%":
			left.number = math.Mod(left.number, right.number)
		default:
			return runtimeValue{}, false
		}
		return left, true
	}
	if left.kind == runtimeBigInt {
		result := new(big.Int)
		switch operator {
		case "+":
			result.Add(left.bigint, right.bigint)
		case "-":
			result.Sub(left.bigint, right.bigint)
		case "*":
			result.Mul(left.bigint, right.bigint)
		case "/":
			if right.bigint.Sign() == 0 {
				return runtimeValue{}, false
			}
			result.Quo(left.bigint, right.bigint)
		case "%":
			if right.bigint.Sign() == 0 {
				return runtimeValue{}, false
			}
			result.Rem(left.bigint, right.bigint)
		default:
			return runtimeValue{}, false
		}
		return runtimeValue{kind: runtimeBigInt, bigint: result}, true
	}
	return runtimeValue{}, false
}
