// NOTES:
// nesting is determined by lines -- this can likely be improved, what if same line?
// bradley mentioned a better data structure to store ranges -- what is it and will it actually be faster?


import * as lsp from "vscode-languageserver-protocol"
import { LspClient } from "./langserver-client"

// keys in cache
interface SymbolKey {
	name: string
	kind: lsp.SymbolKind
	module: string
}

// values in cache
export interface SymbolInfo extends lsp.DocumentSymbol {
	isTopLevel: boolean
	uri: string
}

export class NavObject {
	private symToInfo: Map<string, SymbolInfo> = new Map()
	private client: LspClient

	constructor(client: LspClient) {
		client.on("documentSymbol", this.rebuildMaps.bind(this))
		this.client = client
	}

	/*
	 * Encodes symbol information into a string key.
	 * We have to do this because objects can't be keys (pointer equality)
	 * and JSON objects have no defined order for their keys.
	 *
	 * @param key  The SymbolKey to encode.
	 * @returns    A string that can be used as a unique key.
	 */
	_symbolKeyToString(key: SymbolKey): string {
		return JSON.stringify([key.name, key.kind, key.module])
	}

	_stringToSymbolKey(str: string): SymbolKey {
		const arr = JSON.parse(str)
		return { name: arr[0], kind: arr[1], module: arr[2] }
	}

	/*
	 * Rebuilds symToInfo. Should be called on file load, return, save.
	 */
	rebuildMaps(symbols: lsp.DocumentSymbol[] | lsp.SymbolInformation[], uri: string) {
		// Used to check that the given parameter is type documentSymbol[]
		function isDocumentSymbolArray(symbols: lsp.DocumentSymbol[] | lsp.SymbolInformation[]): symbols is lsp.DocumentSymbol[] {
			return (symbols as lsp.DocumentSymbol[]).length === 0 || (symbols as lsp.DocumentSymbol[])[0].children !== undefined
		}

		// adds a documentSymbol and all of its children to symToInfo
		const addSymbolToMap = (symbol: lsp.DocumentSymbol, isTopLevel: boolean) => {
			// create map key
			const symKey: SymbolKey = {
				name: symbol.name,
				kind: symbol.kind,
				module: (symbol as any)["rayBensModule"],
			}

			// create map value
			let symInfo: SymbolInfo = symbol as SymbolInfo
			symInfo.isTopLevel = isTopLevel
			symInfo.uri = uri

			// add to map
			this.symToInfo.set(this._symbolKeyToString(symKey), symInfo)

			// add children
			if (symbol.children !== null && symbol.children !== undefined) {
				for (const child of symbol.children) {
					addSymbolToMap(child, false)
				}
			}
		}

		// check that response is DocumentSymbol[]
		if (!isDocumentSymbolArray(symbols)) {
			throw new Error("expected DocumentSymbol[], got something else")
		}

		// clear all entries with the given uri
		for (const key in this.symToInfo) {
			if (this.symToInfo[key].uri === uri) {
				delete this.symToInfo[key]
			}
		}
		// add all symbols recieved
		for (const symbol of symbols) {
			addSymbolToMap(symbol, true)
		}
	}

	/**
	 * Finds the innermost symbol at a given location, if any
	 * @param loc location of desired symbol
	 */
	bestSymbolForLocation(loc: lsp.Location): SymbolInfo | null {
		let bestScore: number | null = null
		let bestSymbol: SymbolInfo | null = null

		const range = loc.range

		// search for tightest enclosing scope for this reference
		for (const [key, symbol] of this.symToInfo) {
			const cachedRange = symbol.range

			// test if cachedRange is the tightest known bound around range
			if (((cachedRange.start.line <= range.start.line && cachedRange.end.line >= range.end.line) // range entirely within cachedRange (inclusive)
					  || ((cachedRange.start.line === range.start.line && cachedRange.start.character <= range.start.character)
					      && (cachedRange.end.line === range.end.line && cachedRange.end.character >= range.end.character)))
					&& (bestScore === null || cachedRange.end.line - cachedRange.start.line < bestScore) // tightest line bound so far
					&& (symbol.kind !== lsp.SymbolKind.Variable) // is not a variable declaration
				  ) {
					bestScore = cachedRange.end.line - cachedRange.start.line
					bestSymbol = symbol
			}
		}

		return bestSymbol
	}

	/*
	 * Finds the callers of a function whose name is at the position given. Should be called on navigate, return, save.
	 * @param symPos  A position object representing the position of the name of the function to find callers of.
	 * @returns       An array of DocumentSymbol objects with ranges that enclose the definitions of calling functions.
	 */
	findCallers(symPos: lsp.TextDocumentPositionParams): Thenable<SymbolInfo[]> {
		const request: lsp.ReferenceParams = {
		  textDocument: symPos.textDocument,
		  position: symPos.position,
		  context: {
				includeDeclaration: false,
		  },
		}

		return this.client.getReferencesWithRequest(request)
			.then((response: lsp.Location[] | null) => {
				const output: SymbolInfo[] = []

				// for each reference recieved, find parent scope
				for (const receivedRef of (response ?? [])) {
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
	 * @returns    An array of DocumentSymbol objects with ranges that enclose the definitions of functions being called in the given function.
	 */
	findCallees(parentSymbol: lsp.DocumentSymbol): Thenable<SymbolInfo[]> {
		return this.client.getUsedDocumentSymbols("untitled:///file") // TODO: consume via event handler like rebuildMaps
			.then((result: lsp.DocumentSymbol[] | lsp.SymbolInformation[] | null) => {
				// Used to check that the given parameter is type documentSymbol[]
				function isSymbolInformationArray(symbols: lsp.DocumentSymbol[] | lsp.SymbolInformation[]): symbols is lsp.SymbolInformation[] {
					return (symbols as lsp.SymbolInformation[]).length === 0 || (symbols as lsp.SymbolInformation[])[0].location !== undefined
				}

				if (result === null || !isSymbolInformationArray(result)) {
					throw new Error("expected symbolInformation[], got something else")
				}

				const output: SymbolInfo[] = []

				// for each completion received, find matching location
				for (const symbol of result) {
					// since we're using the whole-document usedDocumentSymbols
					// just to get callees of a specific function, we need to filter out
					// used document symbols that are not used within the function we care about.
					// TODO: we should treat usedDocumentSymbols like documentSymbols, i.e.
					// we should store it as long as we can then invalidate when necessary
					// TODO: we may also want to use an existing "call graph" API
					// https://github.com/microsoft/language-server-protocol/issues/468
					const usageRange: lsp.Range = (symbol as any)["rayBensUsageRange"]
					if (!(usageRange.start.line >= parentSymbol.range.start.line
							&& usageRange.end.line <= parentSymbol.range.end.line)) {
						continue
					}

					// TODO: see above, but we also want to filter out things
					// defined within the parent symbol scope
					if (symbol.location.range.start.line >= parentSymbol.range.start.line
							&& symbol.location.range.end.line <= parentSymbol.range.end.line) {
						continue
					}

					// find completion's definition range
					const testSymKey: SymbolKey = {
						name: symbol.name,
						kind: symbol.kind,
						module: (symbol as any)["rayBensModule"],
					}

					const desiredInfo = this.symToInfo.get(this._symbolKeyToString(testSymKey))

					// if not found, ignore it
					if (desiredInfo) {
						output.push(desiredInfo)
					}
				}

				return output
			})
	}

	findCachedSymbol(key: SymbolKey): SymbolInfo | undefined {
		return this.symToInfo.get(this._symbolKeyToString(key))
	}

	// finds all symbols in the cache that are functions called "main" and returns them.
	findMain(): SymbolInfo[] {
		const results: SymbolInfo[] = []
		for (const [key, symInfo] of this.symToInfo) {
			const symKey = this._stringToSymbolKey(key)
			if ((symKey.name.toLowerCase() === "main") && symKey.kind === lsp.SymbolKind.Function) {
				results.push(symInfo)
			}
		}
		return results
	}

	findTopLevelSymbols(context: string): lsp.DocumentSymbol[] {
		// TODO: filter to only symbols that are in the
		// context/module/filename that was passed in
		return [...this.symToInfo]
			.filter(([key, symbol]) => symbol.isTopLevel === true)
			.map(([key, symbol]) => symbol)
	}
}
