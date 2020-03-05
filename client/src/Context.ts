import * as lsp from "vscode-languageserver-protocol"
import { SymbolInfo } from "./nav-object"

const extractRangeOfFile = function(file, range): string {
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

export class Context{
	// TODO: add linerize function
	public readonly name: string
	public readonly uri: string
	private _hasChanges: boolean = false
	private _hasLineNumberChanges: boolean = false
	private _fileString: string
	public topLevelSymbols: { [name: string]: { symbol: SymbolInfo; definitionString: string } }
	public topLevelCode: string | null

	constructor(name: string, uri: string, fileString: string) {
		this.uri = uri
		this.name = name
		this._fileString = fileString
		this.topLevelCode = null
		this.topLevelSymbols = {}
	}

	get fileString() {
		return this._fileString
	}
	set fileString(newFileString: string) {
		const oldLineCount = this._fileString.split("\n").length

		this._fileString = newFileString
		this._hasChanges = true

		if (this._fileString.split("\n").length !== oldLineCount) {
			this._hasLineNumberChanges = true
		}
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

					const parentTextArray = potentialParentSymbol.definitionString.split("\n")

					const innerSymbolStartLineInParent = innerRange.start.line - potentialParentSymbol.symbol.range.start.line
					parentTextArray.splice(0, innerSymbolStartLineInParent)

					const innerSymbolEndLineInParent = innerRange.end.line - potentialParentSymbol.symbol.range.start.line
					parentTextArray.length = innerSymbolEndLineInParent

					const retText = parentTextArray.join("\n")
					return [potentialParentSymbol.symbol, retText]
			}
		}
		return null
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
		return this.getSortedTopLevelSymbolNames()
			.map((n) => this.topLevelSymbols[n].definitionString)
			.join("\n\n") + this.topLevelCode
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
	splitFileBySymbols(file: string, topLevelSymbols: SymbolInfo[]): [string, { [name: string]: { symbol: SymbolInfo; definitionString: string } }] {
		// TODO: ensure top level symbol ranges are non-overlapping

		const topLevelSymbolsWithStrings: { [name: string]: { symbol: SymbolInfo; definitionString: string } } = topLevelSymbols
			.map((symbol) => { return {
				symbol: symbol,
				definitionString: extractRangeOfFile(this.fileString, symbol.range)
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
	updateWithNavObject(navObject) {
		// recompute the strings containing the definition of each symbol

		const [topLevelCode, topLevelSymbolsWithStrings] =
			this.splitFileBySymbols(this.fileString, navObject.findTopLevelSymbols(this.uri))

		this.topLevelCode = topLevelCode
		this.topLevelSymbols = topLevelSymbolsWithStrings

		this._hasLineNumberChanges = false
	}
}
