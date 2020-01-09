// NOTES:
// nesting is determined by lines -- this can likely be improved, what if same line?
// bradley mentioned a better data structure to store ranges -- what is it and will it actually be faster?
// use SymbolInformation.containerName to find enclosing scope?


import * as lsp from "vscode-languageserver-protocol"
import { LspClient } from "./langserver-client"


const completionItemKindToSymbolKind = function(kind: lsp.CompletionItemKind): lsp.SymbolKind | null {
	switch (kind) {
		case lsp.CompletionItemKind.Text: return null
		case lsp.CompletionItemKind.Method: return lsp.SymbolKind.Method
		case lsp.CompletionItemKind.Function: return lsp.SymbolKind.Function
		case lsp.CompletionItemKind.Constructor: return lsp.SymbolKind.Constructor
		case lsp.CompletionItemKind.Field: return lsp.SymbolKind.Field
		case lsp.CompletionItemKind.Variable: return lsp.SymbolKind.Variable
		case lsp.CompletionItemKind.Class: return lsp.SymbolKind.Class
		case lsp.CompletionItemKind.Interface: return lsp.SymbolKind.Interface
		case lsp.CompletionItemKind.Module: return lsp.SymbolKind.Module
		case lsp.CompletionItemKind.Property: return lsp.SymbolKind.Property
		case lsp.CompletionItemKind.Unit: return null
		case lsp.CompletionItemKind.Value: return null
		case lsp.CompletionItemKind.Enum: return lsp.SymbolKind.Enum
		case lsp.CompletionItemKind.Keyword: return null
		case lsp.CompletionItemKind.Snippet: return null
		case lsp.CompletionItemKind.Color: return null
		case lsp.CompletionItemKind.File: return lsp.SymbolKind.File
		case lsp.CompletionItemKind.Reference: return null
		case lsp.CompletionItemKind.Folder: return null
		case lsp.CompletionItemKind.EnumMember: return lsp.SymbolKind.EnumMember
		case lsp.CompletionItemKind.Constant: return lsp.SymbolKind.Constant
		case lsp.CompletionItemKind.Struct: return lsp.SymbolKind.Struct
		case lsp.CompletionItemKind.Event: return lsp.SymbolKind.Event
		case lsp.CompletionItemKind.Operator: return lsp.SymbolKind.Operator
		case lsp.CompletionItemKind.TypeParameter: return lsp.SymbolKind.TypeParameter
		default: return null
	}
}

interface SymbolKey {
	name: string
	kind: lsp.SymbolKind
	module: string
}

export class NavObject {
	private symToInfo: { [key: string]: lsp.SymbolInformation } = {}
	private client: LspClient

	constructor(client: LspClient) {
		client.on("documentSymbol", x => this.rebuildMaps(x))
		this.client = client
	}

	/*
	 * Encodes symbol information into a string key.
	 * @param key  The SymbolKey to encode.
	 * @returns    A string that can be used as a unique key.
	 */
	symbolKeyToString(key: SymbolKey) {
		// TODO: use kind and module when building key
		return JSON.stringify([key.name, 0, ""])
	}

	/*
	 * Rebuilds symToInfo. Should be called on file load, return, save.
	 */
	rebuildMaps(symbols: lsp.DocumentSymbol[] | lsp.SymbolInformation[]) {

		// Used to check that the gien parameter is type symbolInformation[]
		function isSymbolInformationArray(symbols: lsp.DocumentSymbol[] | lsp.SymbolInformation[]): symbols is lsp.SymbolInformation[] {
			return (symbols as lsp.SymbolInformation[]).length === 0 || (symbols as lsp.SymbolInformation[])[0].location !== undefined
		}

		this.symToInfo = {}
		if (!isSymbolInformationArray(symbols)) {
			throw new Error("expected SymbolInformation[], got something else")
		}

		// add to data structure
		for (const symInfo of symbols) {
			const symKey: string = this.symbolKeyToString({
				name: symInfo.name,
				kind: symInfo.kind,
				module: symInfo.location.uri,
			})
			console.log("SYMINFO_LOCATION")
			console.log(symInfo.location.uri)
			this.symToInfo[symKey] = symInfo
		}
	}

	/**
	 * Finds the innermost symbol at a given location
	 * @param loc location of desired symbol
	 */
	bestSymbolForLocation(loc: lsp.Location): lsp.SymbolInformation | null {
		let bestScore: number | null = null
		let bestKey: string | null = null

		const range = loc.range

		// search for tightest enclosing scope for this reference
		for (const key in this.symToInfo) {
			const cachedRange = this.symToInfo[key].location.range

			// test if cachedRange is the tightest known bound around range
			if (((cachedRange.start.line <= range.start.line && cachedRange.end.line >= range.end.line) // range entirely within cachedRange (inclusive)
					  || ((cachedRange.start.line === range.start.line && cachedRange.start.character <= range.start.character)
					      && (cachedRange.end.line === range.end.line && cachedRange.end.character >= range.end.character)))
					&& (bestScore === null || cachedRange.end.line - cachedRange.start.line < bestScore) // tightest line bound so far
					&& (this.symToInfo[key].kind !== lsp.SymbolKind.Variable)) { // not a variable declaration // TODO: Test
					bestScore = cachedRange.end.line - cachedRange.start.line
					bestKey = key
			}
		}

		if (bestKey) {
			return this.symToInfo[bestKey]
		}

		return null
	}

	/*
	 * Finds the callers of a function whose name is at the position given. Should be called on navigate, return, save.
	 * @param symPos  A position object representing the position of the name of the function to find callers of.
	 * @returns       An array of SymbolInformation objects with ranges that enclose the definitions of calling functions.
	 */
	findCallers(symPos: lsp.TextDocumentPositionParams): Thenable<lsp.SymbolInformation[]> {
		const request: lsp.ReferenceParams = {
		  textDocument: symPos.textDocument,
		  position: symPos.position,
		  context: {
				includeDeclaration: false,
		  },
		}

		return this.client.getReferencesWithRequest(request)
			.then((response: lsp.Location[] | null) => {
				const locations: lsp.Location[] = (response) ? response : []
				const output: lsp.SymbolInformation[] = []

				// for each reference recieved, find parent scope
				for (const receivedRef of locations) {
					const symbol = this.bestSymbolForLocation(receivedRef)

					// if no parents to caller, was called from global scope, so ignore it
					if (symbol !== null) {
						output.push(symbol)
					}
				}

				return output
			})
	}

	/*
	 * Finds all the symbols referenced within the given symbol scope.
	 * @param symbol  The symbol to find calls in.
	 * @returns    An array of SymbolInformation objects with ranges that enclose the definitions of functions being called in the given function.
	 */
	findCallees(parentSymbol: lsp.SymbolInformation): Thenable<lsp.SymbolInformation[]> {
		return this.client.getUsedDocumentSymbols()
			.then((result: lsp.DocumentSymbol[] | lsp.SymbolInformation[] | null) => {
				function isSymbolInformationArray(symbols: lsp.DocumentSymbol[] | lsp.SymbolInformation[]): symbols is lsp.SymbolInformation[] {
					return (symbols as lsp.SymbolInformation[]).length === 0 || (symbols as lsp.SymbolInformation[])[0].location !== undefined
				}

				if (result === null || !isSymbolInformationArray(result)) {
					throw new Error("expected SymbolInformation[], got something else")
				}

				const output: lsp.SymbolInformation[] = []

				// for each completion received, find matching location
				for (const symbol of result) {
					if (symbol.kind === undefined) { continue }
					const kind: lsp.SymbolKind = symbol.kind
					if (kind === null) { continue }

					// since we're using the whole-document usedDocumentSymbols
					// just to get callees of a specific function, we need to filter out
					// used document symbols that are not used within the function we care about.
					// TODO: we should treat usedDocumentSymbols like documentSymbols, i.e.
					// we should store it as long as we can then invalidate when necessary
					// TODO: we may also want to use an existing "call graph" API
					// https://github.com/microsoft/language-server-protocol/issues/468
					const usageRange: lsp.Range = (symbol as any)["rayBensUsageRange"]
					if (!(usageRange.start.line >= parentSymbol.location.range.start.line
							&& usageRange.end.line <= parentSymbol.location.range.end.line)) {
						continue
					}

					// TODO: see above, but we also want to filter out things
					// defined within the parent symbol scope
					if (symbol.location.range.start.line >= parentSymbol.location.range.start.line
							&& symbol.location.range.end.line <= parentSymbol.location.range.end.line) {
						continue
					}

					// find completion's definition range
					const testSymKey: string = this.symbolKeyToString({
						name: symbol.name,
						kind: kind,
						module: (symbol as any)["rayBensModule"],
					})
					const desiredInfo: lsp.SymbolInformation = this.symToInfo[testSymKey]

					// if not found, ignore it
					if (desiredInfo) {
						output.push(desiredInfo)
					}
				}

				return output
			})
	}

	findCachedSymbol(key: SymbolKey): lsp.SymbolInformation | null {
		return this.symToInfo[this.symbolKeyToString(key)] || null
	}
}
