
import * as lsp from "vscode-languageserver-protocol"
import { LspClient } from "./langserver-client"

// keys in symToInfo and usedSyms
export interface SymbolKey {
	name: string
	kind: lsp.SymbolKind
	module: string
}

// values in symToInfo
export interface SymbolInfo extends lsp.DocumentSymbol {
	module: string // rayBensModule
	uri: string
	children: SymbolInfo[] | undefined
}

// values in usedSyms
export interface SymbolCalleeInfo extends lsp.DocumentSymbol {
	module: string // rayBensModule
	uri: string
	callees: string[] // keys
}

export class NavObject {
	// maps stringified SymbolKey to SymbolInfo. Definition heirarchy of symbols in files.
	private symToInfo: Map<string, SymbolInfo>
	// maps stringified SymbolKey to SymbolCalleeInfo. Dependency map of symbols in files.
	private symCallees: Map<string, SymbolCalleeInfo>
	private client: LspClient

	public constructor(client: LspClient) {
		this.symToInfo = new Map()
		this.symCallees = new Map()
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
	 * Clears the symbol cache.
	 */
	public reset() {
		this.symToInfo = new Map()
	}

	/*
	 * Rebuilds symToInfo. Should be called on file load, return, save.
	 */
	public rebuildMaps(definedSymbols: lsp.DocumentSymbol[] | lsp.SymbolInformation[], usedSymbols: lsp.SymbolInformation[] | lsp.DocumentSymbol[], uri: string) {
		// Used to check that the given parameter is type documentSymbol[]
		function isDocumentSymbolArray(symbols: lsp.DocumentSymbol[] | lsp.SymbolInformation[]): symbols is lsp.DocumentSymbol[] {
			return (symbols as lsp.DocumentSymbol[]).length === 0 || (symbols as lsp.DocumentSymbol[])[0].children !== undefined
		}

		// Used to check that the given parameter is type symbolInformation[]
		function isSymbolInformationArray(symbols: lsp.SymbolInformation[] | lsp.DocumentSymbol[]): symbols is lsp.SymbolInformation[] {
			return (symbols as lsp.SymbolInformation[]).length === 0 || (symbols as lsp.SymbolInformation[])[0].location !== undefined
		}

		// converst a DocumentSymbol to a SymbolInfo and returns it
		const convertToSymbolInfo = (symbol: lsp.DocumentSymbol): SymbolInfo => {
			// convert top-level
			const module: string = (symbol as any)["rayBensModule"]
			const symInfo: SymbolInfo = symbol as SymbolInfo
			symInfo.module = module
			symInfo.uri = uri

			// convert children
			if (symbol.children !== null && symbol.children !== undefined) {
				for (const child of symbol.children) {
					convertToSymbolInfo(child)
				}
			}

			return symInfo
		}

		// adds a DocumentSymbol to symCallees, along with its children
		const addToCalleeMapWithChildren = (symbol: lsp.DocumentSymbol) => {
			// convert top-level
			const module: string = (symbol as any)["rayBensModule"]
			const symInfo: SymbolCalleeInfo = symbol as SymbolCalleeInfo
			symInfo.module = module
			symInfo.uri = uri
			symInfo.callees = []

			// convert children
			if (symbol.children !== null && symbol.children !== undefined) {
				for (const child of symbol.children) {
					addToCalleeMapWithChildren(child)
				}
			}

			// create map key
			const symKey: SymbolKey = {
				name: symbol.name,
				kind: symbol.kind,
				module: (symbol as any)["rayBensModule"]
			}

			// add to map
			this.symCallees.set(this._symbolKeyToString(symKey), symInfo)
		}

		// check that definedSymbols is DocumentSymbol[]
		if (!isDocumentSymbolArray(definedSymbols)) {
			throw new Error("expected DocumentSymbol[], got something else")
		}

		// check that usedSymbols is DocumentSymbol[]
		if (!isSymbolInformationArray(usedSymbols)) {
			throw new Error("expected SymbolInformation[], got something else")
		}

		// clear all symToInfo entries with the given URI
		for (const [key, symbol] of this.symToInfo) {
			if (symbol.uri === uri) {
				this.symToInfo.delete(key)
			}
		}

		// clear all symCallees entries with the given URI
		for (const [key, symbol] of this.symCallees) {
			if (symbol.uri === uri) {
				this.symCallees.delete(key)
			}
		}

		// add all documentSymbols recieved to symToInfo
		for (const symbol of definedSymbols) {
			// create symToInfo key
			const symKey: SymbolKey = {
				name: symbol.name,
				kind: symbol.kind,
				module: (symbol as any)["rayBensModule"]
			}
			// create symToInfo value
			const symInfo: SymbolInfo = convertToSymbolInfo(symbol)
			// add to symToInfo
			this.symToInfo.set(this._symbolKeyToString(symKey), symInfo)

			// add to symCallees
			addToCalleeMapWithChildren(symbol)
		}

		// populate callees in usedSyms
		const ignoredKinds: lsp.SymbolKind[] = [lsp.SymbolKind.Function, lsp.SymbolKind.Class]
		for (const [docSymKey, docSymbol] of this.symToInfo) {
			if (docSymbol.uri !== uri)
				continue

			for (const usedSymbol of usedSymbols) {
				const docRange = docSymbol.range
				const usedRange = (usedSymbol as any)["rayBensUsageRange"]
				// if usedRange within docRange && if order matters in relationship && if usedDef is in file,
				// then docSymbol is dependent on usedSymbol, add as dependee
				if (((docRange.start.line <= usedRange.start.line && docRange.end.line >= usedRange.end.line)
						|| ((docRange.start.line === usedRange.start.line && docRange.start.character <= usedRange.start.character)
							&& (docRange.end.line === usedRange.end.line && docRange.end.character >= usedRange.end.character)))
					&& !(ignoredKinds.includes(docSymbol.kind) && ignoredKinds.includes(usedSymbol.kind))
					&& (usedSymbol.location.uri === uri)
				) {
					const calleeKey: SymbolKey = {
						name: usedSymbol.name,
						kind: usedSymbol.kind,
						module: (usedSymbol as any)["rayBensModule"]
					}
					this.symCallees.get(docSymKey)?.callees.push(this._symbolKeyToString(calleeKey))
				}
			}
		}
	}

	/**
	 * Finds the innermost parent symbol for a given location, if any
	 * @param loc location of desired symbol
	 */
	bestSymbolForLocation(loc: lsp.Location): SymbolInfo | null {
		const findParentOfRange = (symbols: SymbolInfo[], location: lsp.Location, bestSymbol: SymbolInfo | null, bestScore: number | null): [SymbolInfo | null, number | null] => {
			if (!symbols) {
				return [bestSymbol, bestScore]
			}

			// search for tightest enclosing scope for this reference
			for (const symbol of symbols) {
				const range = location.range
				// test if symbol is the tightest known bound around range
				if (symbol.uri === location.uri
						&& ((symbol.range.start.line <= range.start.line && symbol.range.end.line >= range.end.line) // range entirely within cachedRange (inclusive)
						|| ((symbol.range.start.line === range.start.line && symbol.range.start.character <= range.start.character)
							&& (symbol.range.end.line === range.end.line && symbol.range.end.character >= range.end.character)))
						&& (bestScore === null || symbol.range.end.line - symbol.range.start.line < bestScore) // tightest line bound so far
						&& (symbol.kind !== lsp.SymbolKind.Variable) // is not a variable declaration
					) {
						bestScore = symbol.range.end.line - symbol.range.start.line
						bestSymbol = symbol
				}
				// test if children have tighter bound
				if (symbol.children !== null && symbol.children !== undefined) {
					const [bestSymbolOfChildren, bestScoreOfChildren] = findParentOfRange(symbol.children, location, bestSymbol, bestScore)

					if (bestScore === null || (bestScoreOfChildren !== null && bestScore !== null && bestScoreOfChildren < bestScore)) {
						bestScore = bestScoreOfChildren
						bestSymbol = bestSymbolOfChildren
					}
				}
			}

			return [bestSymbol, bestScore]
		}

		const [symbol, score] = findParentOfRange(Array.from(this.symToInfo.values()), loc, null, null)

		return symbol
	}

	/*
	 * Finds the callers of a function whose name is at the position given. Should be called on navigate, return, save.
	 * @param symPos  A position object representing the position of the name of the function to find callers of.
	 * @returns       An array of DocumentSymbol objects with ranges that enclose the definitions of calling functions.
	 */
	findCallers(symPos: lsp.TextDocumentPositionParams): Thenable<lsp.Location[]> {
		const request: lsp.ReferenceParams = {
		  textDocument: symPos.textDocument,
		  position: symPos.position,
		  context: {
				includeDeclaration: false,
		  },
		}

		return this.client.getReferencesWithRequest(request)
			.then((response) => response ?? [])
	}

	/*
	 * Finds all the symbols referenced within the given symbol scope.
	 * @param symbol  The symbol to find calls in.
	 * @returns    An array of SymbolInfo objects with ranges that enclose the definitions of functions being called in the given function.
	 */
	findCallees(parentSymbol: SymbolInfo): Thenable<lsp.SymbolInformation[]> {
		return this.client.getUsedDocumentSymbols(parentSymbol.uri)
			.then((result: lsp.DocumentSymbol[] | lsp.SymbolInformation[] | null) => {
				// Used to check that the given parameter is type documentSymbol[]
				function isSymbolInformationArray(symbols: lsp.DocumentSymbol[] | lsp.SymbolInformation[]): symbols is lsp.SymbolInformation[] {
					return (symbols as lsp.SymbolInformation[]).length === 0 || (symbols as lsp.SymbolInformation[])[0].location !== undefined
				}

				if (result === null || !isSymbolInformationArray(result)) {
					throw new Error("expected symbolInformation[], got something else")
				}

				const output: lsp.SymbolInformation[] = []

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
					if (symbol.location.uri == parentSymbol.uri
							&& symbol.location.range.start.line >= parentSymbol.range.start.line
							&& symbol.location.range.end.line <= parentSymbol.range.end.line) {
						continue
					}

					output.push(symbol)
				}

				return output
			})
	}

	findCachedSymbol(key: SymbolKey): SymbolInfo | undefined {
		const findSymbolByKey = (key: SymbolKey, symbols: SymbolInfo[]): SymbolInfo | undefined => {
			// search given symbols
			for (const symInfo of symbols) {
				const childKey: SymbolKey = { name: symInfo.name, kind: symInfo.kind, module: symInfo.module }
				if (this._symbolKeyToString(childKey) === this._symbolKeyToString(key)) {
					return symInfo
				}
				// if not it, search children
				else {
					let result: SymbolInfo | undefined = symInfo.children ? findSymbolByKey(key, symInfo.children) : undefined
					// if found, return it, else continue search
					if (result !== undefined) {
						return result
					}
				}
			}
			// not found
			return undefined
		}

		return findSymbolByKey(key, Array.from(this.symToInfo.values()))
	}

	// finds all symbols in the cache that are functions/methods called "main" and returns them.
	findMain(): SymbolInfo[] {
		// finds all symbols with the given name (case-insensitive)
		const findSymbolByName = (name: string, symbols: SymbolInfo[]): SymbolInfo[] => {
			const results: SymbolInfo[] = []
			// search given symbols
			for (const symInfo of symbols) {
				if (symInfo.name.toLowerCase() === name.toLowerCase() && (symInfo.kind === lsp.SymbolKind.Function || symInfo.kind === lsp.SymbolKind.Method)) {
					results.push(symInfo)
				}
				// search children
				else {
					const result: SymbolInfo[] = symInfo.children ? findSymbolByName(name, symInfo.children) : []
					results.concat(result)
				}
			}

			return results
		}
		console.log(this.symToInfo)
		return findSymbolByName("main", Array.from(this.symToInfo.values()))

	}

	findTopLevelSymbols(uri: string): SymbolInfo[] {
		return [...this.symToInfo]
			.filter(([key, symbol]) => symbol.uri === uri)
			.map(([key, symbol]) => symbol)
	}

	// updates the linearization order according to user edits.
	updateLinearization() {

	}
}
