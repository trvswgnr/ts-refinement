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
	runtimeNull
	runtimeArray
	runtimeFunction
)

type runtimeValue struct {
	kind     runtimeKind
	number   float64
	bigint   *big.Int
	text     string
	boolean  bool
	values   []runtimeValue
	function *node
}

func Evaluate(predicate Predicate, source string) (bool, bool) {
	expression, err := parse(source)
	if err != nil {
		return false, false
	}
	value, ok := evaluateNode(expression, runtimeValue{}, nil)
	if !ok {
		return false, false
	}
	result, ok := evaluateNode(predicate.root, value, nil)
	return result.boolean, ok && result.kind == runtimeBoolean
}

func evaluateNode(expression *node, subject runtimeValue, locals map[string]runtimeValue) (runtimeValue, bool) {
	if expression == nil {
		return runtimeValue{}, false
	}
	switch expression.kind {
	case nodeIdentifier:
		if expression.text == "$subject" {
			return subject, subject.kind != runtimeUnknown
		}
		if value, ok := locals[expression.text]; ok {
			return value, true
		}
		if expression.text == "Infinity" {
			return runtimeValue{kind: runtimeNumber, number: math.Inf(1)}, true
		}
		if expression.text == "NaN" {
			return runtimeValue{kind: runtimeNumber, number: math.NaN()}, true
		}
		if expression.text == "undefined" {
			return runtimeValue{kind: runtimeUnknown}, true
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
	case nodeNull:
		return runtimeValue{kind: runtimeNull}, true
	case nodeArray:
		values := make([]runtimeValue, len(expression.args))
		for index, element := range expression.args {
			value, ok := evaluateNode(element, subject, locals)
			if !ok {
				return runtimeValue{}, false
			}
			values[index] = value
		}
		return runtimeValue{kind: runtimeArray, values: values}, true
	case nodeFunction:
		return runtimeValue{kind: runtimeFunction, function: expression}, true
	case nodeUnary:
		operand, ok := evaluateNode(expression.left, subject, locals)
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
		case "typeof":
			name := map[runtimeKind]string{
				runtimeNumber: "number", runtimeBigInt: "bigint", runtimeString: "string",
				runtimeBoolean: "boolean", runtimeFunction: "function", runtimeUnknown: "undefined",
			}[operand.kind]
			if name != "" {
				return runtimeValue{kind: runtimeString, text: name}, true
			}
			if operand.kind == runtimeBigInt {
				operand.bigint = new(big.Int).Neg(operand.bigint)
				return operand, true
			}
		}
		return runtimeValue{}, false
	case nodeMember:
		object, ok := evaluateNode(expression.left, subject, locals)
		if !ok || expression.text != "length" || (object.kind != runtimeString && object.kind != runtimeArray) {
			return runtimeValue{}, false
		}
		length := len(object.text)
		if object.kind == runtimeArray {
			length = len(object.values)
		}
		return runtimeValue{kind: runtimeNumber, number: float64(length)}, true
	case nodeIndex:
		object, ok := evaluateNode(expression.left, subject, locals)
		if !ok || object.kind != runtimeArray {
			return runtimeValue{}, false
		}
		index, ok := evaluateNode(expression.right, subject, locals)
		if !ok || index.kind != runtimeNumber || math.Trunc(index.number) != index.number || index.number < 0 || int(index.number) >= len(object.values) {
			return runtimeValue{}, false
		}
		return object.values[int(index.number)], true
	case nodeCall:
		return evaluateCall(expression, subject, locals)
	case nodeBinary:
		return evaluateBinary(expression, subject, locals)
	case nodeConditional:
		condition, ok := evaluateNode(expression.left, subject, locals)
		if !ok {
			return runtimeValue{}, false
		}
		truth, ok := truthy(condition)
		if !ok {
			return runtimeValue{}, false
		}
		if truth {
			return evaluateNode(expression.right, subject, locals)
		}
		return evaluateNode(expression.third, subject, locals)
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
	case runtimeNull, runtimeUnknown:
		return false, true
	case runtimeArray, runtimeFunction:
		return true, true
	default:
		return false, false
	}
}

func evaluateCall(expression *node, subject runtimeValue, locals map[string]runtimeValue) (runtimeValue, bool) {
	callee := expression.left
	if callee == nil || callee.kind != nodeMember || callee.left == nil || len(expression.args) != 1 {
		return runtimeValue{}, false
	}
	argument, ok := evaluateNode(expression.args[0], subject, locals)
	if !ok {
		return runtimeValue{}, false
	}
	if callee.left.kind == nodeIdentifier && callee.left.text == "Number" {
		switch callee.text {
		case "isFinite":
			return runtimeValue{kind: runtimeBoolean, boolean: argument.kind == runtimeNumber && !math.IsNaN(argument.number) && !math.IsInf(argument.number, 0)}, true
		case "isInteger":
			return runtimeValue{kind: runtimeBoolean, boolean: argument.kind == runtimeNumber && !math.IsNaN(argument.number) && !math.IsInf(argument.number, 0) && math.Trunc(argument.number) == argument.number}, true
		}
	}
	if callee.left.kind == nodeIdentifier && callee.left.text == "Math" && callee.text == "abs" && argument.kind == runtimeNumber {
		argument.number = math.Abs(argument.number)
		return argument, true
	}
	object, ok := evaluateNode(callee.left, subject, locals)
	if ok && object.kind == runtimeArray && argument.kind == runtimeFunction && (callee.text == "every" || callee.text == "some") {
		result := callee.text == "every"
		for index, value := range object.values {
			callbackLocals := make(map[string]runtimeValue, len(locals)+len(argument.function.params))
			for name, local := range locals {
				callbackLocals[name] = local
			}
			if len(argument.function.params) > 0 {
				callbackLocals[argument.function.params[0]] = value
			}
			if len(argument.function.params) > 1 {
				callbackLocals[argument.function.params[1]] = runtimeValue{kind: runtimeNumber, number: float64(index)}
			}
			callback, known := evaluateNode(argument.function.left, subject, callbackLocals)
			truth, truthKnown := truthy(callback)
			if !known || !truthKnown {
				return runtimeValue{}, false
			}
			if callee.text == "every" && !truth {
				return runtimeValue{kind: runtimeBoolean, boolean: false}, true
			}
			if callee.text == "some" && truth {
				return runtimeValue{kind: runtimeBoolean, boolean: true}, true
			}
		}
		return runtimeValue{kind: runtimeBoolean, boolean: result}, true
	}
	return runtimeValue{}, false
}

func evaluateBinary(expression *node, subject runtimeValue, locals map[string]runtimeValue) (runtimeValue, bool) {
	left, ok := evaluateNode(expression.left, subject, locals)
	if !ok {
		return runtimeValue{}, false
	}
	if expression.text == "&&" || expression.text == "||" || expression.text == "??" {
		if expression.text == "??" {
			if left.kind != runtimeNull && left.kind != runtimeUnknown {
				return left, true
			}
			return evaluateNode(expression.right, subject, locals)
		}
		leftTruthy, ok := truthy(left)
		if !ok {
			return runtimeValue{}, false
		}
		if expression.text == "&&" && !leftTruthy || expression.text == "||" && leftTruthy {
			return runtimeValue{kind: runtimeBoolean, boolean: leftTruthy}, true
		}
		return evaluateNode(expression.right, subject, locals)
	}
	right, ok := evaluateNode(expression.right, subject, locals)
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
