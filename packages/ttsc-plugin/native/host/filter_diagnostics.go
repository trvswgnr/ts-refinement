package host

import (
	"path/filepath"

	shimast "github.com/microsoft/typescript-go/shim/ast"
	shimchecker "github.com/microsoft/typescript-go/shim/checker"
	"github.com/samchon/ttsc/packages/ttsc/driver"
)

type refinementTransfer struct {
	sourceExpression *shimast.Node
	targetType       *shimchecker.Type
}

func filterEntailedRefinementDiagnostics(
	checker *shimchecker.Checker,
	files []*shimast.SourceFile,
	diagnostics []driver.Diagnostic,
) []driver.Diagnostic {
	filesByName := make(map[string]*shimast.SourceFile, len(files))
	for _, file := range files {
		filesByName[filepath.Clean(file.FileName())] = file
	}
	filtered := diagnostics[:0]
	for _, diagnostic := range diagnostics {
		if (diagnostic.Code != 1360 && diagnostic.Code != 2322 && diagnostic.Code != 2345 && diagnostic.Code != 2352) ||
			diagnostic.Start == nil || diagnostic.Length == nil {
			filtered = append(filtered, diagnostic)
			continue
		}
		file := filesByName[filepath.Clean(diagnostic.File)]
		transfers := findTransfers(checker, file, diagnostic.Code, *diagnostic.Start, *diagnostic.Length)
		if len(transfers) != 1 || !transferIsEntailed(checker, transfers[0]) {
			filtered = append(filtered, diagnostic)
		}
	}
	return filtered
}

func findTransfers(
	checker *shimchecker.Checker,
	file *shimast.SourceFile,
	code int32,
	start, length int,
) []*refinementTransfer {
	if checker == nil || file == nil {
		return nil
	}
	transfers := []*refinementTransfer{}
	var visit func(*shimast.Node)
	visit = func(node *shimast.Node) {
		if node == nil {
			return
		}
		if code == 2322 {
			if transfer := declarationTransfer(checker, file, node, start, length); transfer != nil {
				transfers = append(transfers, transfer)
			}
			switch node.Kind {
			case shimast.KindBinaryExpression:
				binary := node.AsBinaryExpression()
				if binary.OperatorToken != nil && binary.OperatorToken.Kind == shimast.KindEqualsToken &&
					(hasExactSpan(file, node, start, length) ||
						hasExactSpan(file, binary.Left, start, length) ||
						hasExactSpan(file, binary.Right, start, length)) {
					transfers = append(transfers, &refinementTransfer{
						sourceExpression: binary.Right,
						targetType:       checker.GetTypeAtLocation(binary.Left),
					})
				}
			case shimast.KindReturnStatement:
				statement := node.AsReturnStatement()
				if statement.Expression != nil && tokenStart(file, node) == start {
					if target := containingReturnType(checker, node); target != nil {
						transfers = append(transfers, &refinementTransfer{sourceExpression: statement.Expression, targetType: target})
					}
				}
			case shimast.KindArrayLiteralExpression:
				for _, element := range node.AsArrayLiteralExpression().Elements.Nodes {
					if hasExactSpan(file, element, start, length) {
						if target := checker.GetContextualType(element, 0); target != nil {
							transfers = append(transfers, &refinementTransfer{sourceExpression: element, targetType: target})
						}
					}
				}
			case shimast.KindPropertyAssignment:
				property := node.AsPropertyAssignment()
				if hasExactSpan(file, property.Name(), start, length) {
					if target := checker.GetContextualType(property.Initializer, 0); target != nil {
						transfers = append(transfers, &refinementTransfer{sourceExpression: property.Initializer, targetType: target})
					}
				}
			case shimast.KindArrowFunction:
				body := node.AsArrowFunction().Body
				if body != nil && body.Kind != shimast.KindBlock && hasExactSpan(file, body, start, length) {
					if target := functionReturnType(checker, node); target != nil {
						transfers = append(transfers, &refinementTransfer{sourceExpression: body, targetType: target})
					}
				}
			}
		}
		if code == 2345 && (node.Kind == shimast.KindCallExpression || node.Kind == shimast.KindNewExpression) {
			arguments := callArguments(node)
			if arguments != nil {
				for index, argument := range arguments.Nodes {
					if hasExactSpan(file, argument, start, length) {
						if target := argumentTargetType(checker, node, argument, index); target != nil {
							transfers = append(transfers, &refinementTransfer{sourceExpression: argument, targetType: target})
						}
					}
				}
			}
		}
		if code == 2352 && hasExactSpan(file, node, start, length) {
			if site, ok := assertionAt(node); ok {
				transfers = append(transfers, &refinementTransfer{
					sourceExpression: site.expression,
					targetType:       checker.GetTypeAtLocation(site.typeNode),
				})
			}
		}
		if code == 1360 && node.Kind == shimast.KindSatisfiesExpression {
			satisfies := node.AsSatisfiesExpression()
			if satisfies != nil && satisfies.Expression != nil && satisfies.Type != nil &&
				start >= satisfies.Expression.End() && start <= tokenStart(file, satisfies.Type) {
				transfers = append(transfers, &refinementTransfer{
					sourceExpression: satisfies.Expression,
					targetType:       checker.GetTypeAtLocation(satisfies.Type),
				})
			}
		}
		node.ForEachChild(func(child *shimast.Node) bool {
			visit(child)
			return false
		})
	}
	visit(file.AsNode())
	return transfers
}

func declarationTransfer(
	checker *shimchecker.Checker,
	file *shimast.SourceFile,
	node *shimast.Node,
	start, length int,
) *refinementTransfer {
	switch node.Kind {
	case shimast.KindVariableDeclaration, shimast.KindPropertyDeclaration, shimast.KindParameter:
	default:
		return nil
	}
	typeNode := node.Type()
	initializer := node.Initializer()
	if typeNode == nil || initializer == nil || !hasExactSpan(file, node.Name(), start, length) {
		return nil
	}
	return &refinementTransfer{
		sourceExpression: initializer,
		targetType:       checker.GetTypeAtLocation(typeNode),
	}
}

func callArguments(node *shimast.Node) *shimast.ElementList {
	switch node.Kind {
	case shimast.KindCallExpression:
		return node.AsCallExpression().Arguments
	case shimast.KindNewExpression:
		return node.AsNewExpression().Arguments
	default:
		return nil
	}
}

func containingReturnType(checker *shimchecker.Checker, node *shimast.Node) *shimchecker.Type {
	for declaration := node.Parent; declaration != nil; declaration = declaration.Parent {
		if shimast.IsFunctionLike(declaration) {
			return functionReturnType(checker, declaration)
		}
	}
	return nil
}

func functionReturnType(checker *shimchecker.Checker, declaration *shimast.Node) *shimchecker.Type {
	if typeNode := declaration.Type(); typeNode != nil {
		return checker.GetTypeAtLocation(typeNode)
	}
	if declaration.Kind == shimast.KindArrowFunction || declaration.Kind == shimast.KindFunctionExpression {
		if contextual := checker.GetContextualType(declaration, 0); contextual != nil {
			if signatures := shimchecker.Checker_getSignaturesOfType(checker, contextual, shimchecker.SignatureKindCall); len(signatures) > 0 {
				return shimchecker.Checker_getReturnTypeOfSignature(checker, signatures[0])
			}
		}
	}
	return shimchecker.Checker_getReturnTypeOfSignature(checker, checker.GetSignatureFromDeclaration(declaration))
}

func argumentTargetType(
	checker *shimchecker.Checker,
	call, argument *shimast.Node,
	index int,
) *shimchecker.Type {
	signature := checker.GetResolvedSignature(call)
	if signature == nil {
		return nil
	}
	parameters := signature.Parameters()
	if len(parameters) == 0 {
		return nil
	}
	if signature.HasRestParameter() && index >= len(parameters)-1 {
		return shimchecker.Checker_getRestTypeOfSignature(checker, signature)
	}
	if index >= len(parameters) {
		index = len(parameters) - 1
	}
	return shimchecker.Checker_getTypeOfSymbolAtLocation(checker, parameters[index], argument)
}

func hasExactSpan(file *shimast.SourceFile, node *shimast.Node, start, length int) bool {
	return node != nil && tokenStart(file, node) == start && node.End()-tokenStart(file, node) == length
}

func transferIsEntailed(checker *shimchecker.Checker, transfer *refinementTransfer) bool {
	if checker == nil || transfer == nil || transfer.sourceExpression == nil || transfer.targetType == nil {
		return false
	}
	sourceType := checker.GetTypeAtLocation(transfer.sourceExpression)
	sourceHasRefinement, sourceValid := containsRefinement(checker, sourceType)
	targetHasRefinement, targetValid := containsRefinement(checker, transfer.targetType)
	return sourceValid && targetValid && sourceHasRefinement && targetHasRefinement &&
		refinementStructureIsEntailed(checker, sourceType, transfer.targetType)
}
