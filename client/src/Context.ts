import * as lsp from "vscode-languageserver-types"
import { SymbolInfo, NavObject } from "./nav-object"

const extractRangeOfFile = function(file: string, range: lsp.Range): string {
	const allLines = file.split("\n") // TODO: worry about other line endings

	if (range.start.line === range.end.line) {
		return allLines[range.start.line].slice(range.start.character, range.end.character)
	}

	if (range.end.character === 0) {
		const lines = allLines.slice(range.start.line, range.end.line).concat([""])
		lines[0] = lines[0].slice(range.start.character, undefined)
		return lines.join("\n")
	}

	const lines = allLines.slice(range.start.line, range.end.line + 1)

	lines[0] = lines[0].slice(range.start.character, undefined)
	lines[lines.length - 1] = lines[lines.length - 1].slice(undefined, range.end.character)

	return lines.join("\n")
}

export interface DefinedSymbol {
	symbol: SymbolInfo
	definitionString: string
}

export interface DisplaySymbolTree {
	// jqtree
	name: string
	id: any
	children?: DisplaySymbolTree[]
	// our custom stuff
	rayBensSymbol?: SymbolInfo
}

export class Context {
	public name: string
	public readonly uri: string
	private _hasChanges: boolean = false
	// hasLineNumberChanges is initially true until we receive the nav object once
	private _hasLineNumberChanges: boolean = true
	private topLevelSymbols: { [name: string]: DefinedSymbol }
	private _topLevelCode: string | null

	constructor(name: string, uri: string) {
		this.uri = uri
		this.name = name
		this._topLevelCode = null
		this.topLevelSymbols = {}
	}

	get topLevelCode(): string | null {
		return this._topLevelCode
	}

	get hasChanges(): boolean {
		return this._hasChanges
	}

	get hasLineNumberChanges(): boolean {
		return this._hasLineNumberChanges
	}

	/**
	 * Given a lsp.SymbolInformation object. Determins if a toplevel code contains that symbole.
	 * If a toplevel code does contain the given symbol, return the top level symbol and the top level code of that symbole.
	 * If the given symbol is not contained in any top-level code, return null.
	 * @param innerSymbol Symbol to get top-level that contains it.
	 * @returns Tuple of toplevel code string and toplevel symbol.
	 */
	getTopLevelSymbolContaining(innerSymbol: lsp.SymbolInformation | SymbolInfo): [SymbolInfo, string] | null {
		function isLspSymbolInformation(x: SymbolInfo | lsp.SymbolInformation): x is lsp.SymbolInformation {
			return (x as lsp.SymbolInformation).location !== undefined
		}

		const innerRange = isLspSymbolInformation(innerSymbol) ? innerSymbol.location.range : innerSymbol.range

		// loop through topLevelSymbols
		for(const potentialParentSymbol of Object.values(this.topLevelSymbols)){
			// check if innerSymbol is within current symbole
			if(potentialParentSymbol.symbol.range.start.line < innerRange.start.line &&
				potentialParentSymbol.symbol.range.end.line >= innerRange.end.line){
					if (innerSymbol.kind === lsp.SymbolKind.Variable) {
						return [potentialParentSymbol.symbol, potentialParentSymbol.definitionString]
					}

					const startLineWithinParent = innerRange.start.line - potentialParentSymbol.symbol.range.start.line
					const endLineWithinParent = innerRange.end.line - potentialParentSymbol.symbol.range.start.line

					const rangeToExtract = {
						start: { line: startLineWithinParent, character: 0 },
						end: { line: endLineWithinParent, character: 0 }
					}

					const retText = extractRangeOfFile(potentialParentSymbol.definitionString, rangeToExtract)
					return [potentialParentSymbol.symbol, retText]
			}
		}
		return null
	}

	getTopLevelSymbol(name: string): DefinedSymbol | undefined {
		return this.topLevelSymbols[name]
	}

	getSortedTopLevelSymbolNames() {
		// sort the top level symbols by their original line number
		const symbolNames: string[] = Object.keys(this.topLevelSymbols)
		symbolNames.sort((a, b) => {
			const linea = this.topLevelSymbols[a].symbol.range.start.line
			const lineb = this.topLevelSymbols[b].symbol.range.start.line

			return (linea < lineb) ? -1
				: (linea > lineb) ? 1
				: 0
		})
		return symbolNames
	}

	/**
	 * Combines all the top level code and symbol definition strings
	 * into one large string representing the entire context/file.
	 *
	 * @returns entire file
	 */
	getLinearizedCode(): string {
		// get each top level symbol definition
		let DNRs: [string, DefinedSymbol][] =
			Object.entries(this.topLevelSymbols)

		// assert no "definition name range"s overlap partially
		// and condense DNRs that overlap completely
		DNRs = DNRs
			.filter(([_key, s], index) => {
				let distinct = true

				for (let j = index + 1; j < DNRs.length; j++) {
					const range1 = s.symbol.range
					const range2 = DNRs[j][1].symbol.range

					const endLine1 = range1.end.character === 0
						? range1.end.line : range1.end.line + 1
					const endLine2 = range2.end.character === 0
						? range2.end.line : range2.end.line + 1

					const equal = range1.start.line === range2.start.line
						&& endLine1 === endLine2
					const disjoint = range1.start.line >= endLine2
						|| range2.start.line >= endLine1

					if (equal) distinct = false

					console.assert(equal || disjoint)
				}

				return distinct
			})

		// order DNRs by member dependencies
		// TODO: currently sorting by original order
		DNRs.sort(([_ka, sa], [_kb, sb]) => {
			const linea = sa.symbol.range.start.line
			const lineb = sb.symbol.range.start.line

			return (linea < lineb) ? -1
				: (linea > lineb) ? 1
				: 0
		})

		// concatenate DNRs
		const dnrString = DNRs
			.map(([_k, s]) => s.definitionString)
			.join("\n\n")

		// append top level code
		const file = dnrString + this.topLevelCode

		return file
	}

	/**
	 * Splits the given file into string chunks.
	 *
	 * The dictionary of string chunks maps top-level symbol names to the lines
	 * of code that comprise their definitions.
	 *
	 * The first returned string chunk contains all lines of code that are not
	 * part of a top-level symbol definition, i.e. "top level code".
	 *
	 * @param file            the file to split
	 * @param topLevelSymbols array of top-level (no parent container) symbols
	 *
	 * @returns [top level code string, top-level definition strings by symbol name]
	 */
	private static splitFileBySymbols(file: string, topLevelSymbols: SymbolInfo[]): [string, { [name: string]: DefinedSymbol }] {
		const topLevelSymbolsWithStrings: { [name: string]: DefinedSymbol } = topLevelSymbols
			.map((symbol) => { return {
				symbol: symbol,
				definitionString: extractRangeOfFile(file, symbol.range)
			} })
			.reduce((prev, cur) => {
				prev[cur.symbol.name] = cur
				return prev
			}, {})

		const linenosUsedByTopLevelSymbols: Set<number> = topLevelSymbols
			.reduce((prev: Set<number>, cur) => {
				const range = cur.range
				const end = (range.end.character > 0) ? (range.end.line + 1) : range.end.line
				for (let i = range.start.line; i < end; i++) {
					prev.add(i)
				}
				return prev
			}, new Set<number>())

		const topLevelCode = file.split("\n") // TODO: worry about other line endings
			.filter((line, lineno) => !linenosUsedByTopLevelSymbols.has(lineno))
			.filter((line) => line.trim() !== "")
			.join("\n")

		return [topLevelCode, topLevelSymbolsWithStrings]
	}

	/**
	 * Called when the nav object's symbol cache is updated.
	 *
	 * @param navObject  The updated navObject
	 */
	updateWithNavObject(fileString: string, navObject: NavObject) {
		// recompute the strings containing the definition of each symbol

		const [topLevelCode, topLevelSymbolsWithStrings] =
			Context.splitFileBySymbols(fileString, navObject.findTopLevelSymbols(this.uri))

		this._topLevelCode = topLevelCode
		this.topLevelSymbols = topLevelSymbolsWithStrings

		this._hasLineNumberChanges = false
	}

	/**
	 * Returns the line number that the target symbol `definitionString`
	 * begins on within `fileString`.
	 *
	 * @param targetSymbol The symbol to find the line number of
	 */
	getFirstLineOfSymbol(targetSymbol: SymbolInfo): number {
		let lineno = 0
		let found = false

		for (const symbolName of this.getSortedTopLevelSymbolNames()) {
			if (symbolName === targetSymbol.name) {
				found = true
				break
			}

			const symbol = this.topLevelSymbols[symbolName]
			const lineCount = symbol.definitionString.split("\n").length
			lineno += lineCount - 1
			lineno += 2 // add padding added by `getLinearizedCode`
		}

		console.assert(found)

		return lineno
	}

	/**
	 * Updates the known definition string of the given symbol
	 * with the provided definition string.
	 *
	 * Re-linearizes the file and updates the `fileString` property.
	 * Sets `hasChanges` and `hasLineNumberChanges` accordingly.
	 *
	 * @param symbol     The symbol to update
	 * @param definition The new symbol definition body
	 */
	updateSymbolDefinition(symbol: SymbolInfo, definition: string): void {
		const ourSymbol = this.topLevelSymbols[symbol.name]

		const oldDefinitionString = ourSymbol.definitionString

		ourSymbol.definitionString = definition

		this._hasChanges = true

		const oldLineCount = oldDefinitionString.split("\n").length
		if (definition.split("\n").length !== oldLineCount) {
			this._hasLineNumberChanges = true
		}
	}

	findStartingSymbol(): SymbolInfo | undefined {
		const main = this.topLevelSymbols["main"]?.symbol
		if (main) {
			return main
		}

		const firstFunc = Object.values(this.topLevelSymbols)
			.filter((v) => v.symbol.kind === lsp.SymbolKind.Function)
			.map((v) => v.symbol)
			[0]
		if (firstFunc) {
			return firstFunc
		}

		const firstNonImport = Object.values(this.topLevelSymbols)
			.filter((v) => v.symbol.kind !== lsp.SymbolKind.Module)
			.map((v) => v.symbol)
			[0]
		if (firstNonImport) {
			return firstNonImport
		}

		return Object.values(this.topLevelSymbols)[0].symbol
	}

	/**
	 * Returns a tree of
	 */
	getDisplaySymbolTree(): DisplaySymbolTree[] {
		const symbolToTreeItem = (symbol: SymbolInfo): DisplaySymbolTree => {
			return {
				rayBensSymbol: symbol,
				name: symbol.name,
				id: symbol.detail,
				children: (symbol.children ?? []).map(symbolToTreeItem)
			}
		}

		return this.getSortedTopLevelSymbolNames()
			.map((key) => symbolToTreeItem(this.topLevelSymbols[key].symbol))
	}
}
