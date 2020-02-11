import * as lsp from "vscode-languageserver-protocol"
import { SymbolKey, SymbolInfo, SymbolCalleeInfo } from "./nav-object"

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

	getSortedTopLevelSymbolNames() {
		const sortedSymbolNames: string[] = []

		// first add imports (modules)
		Object.keys(this.topLevelSymbols).forEach(name => {
			if (this.topLevelSymbols[name].symbol.kind === lsp.SymbolKind.Module) {
				sortedSymbolNames.push(name)
			}
		})

		// then add functions and classes
		Object.keys(this.topLevelSymbols).forEach(name => {
			if (this.topLevelSymbols[name].symbol.kind === lsp.SymbolKind.Function
				|| this.topLevelSymbols[name].symbol.kind === lsp.SymbolKind.Class) {
				sortedSymbolNames.push(name)
			}
		})

		// then add everything else
		Object.keys(this.topLevelSymbols).forEach(name => {
			if (this.topLevelSymbols[name].symbol.kind !== lsp.SymbolKind.Module
				&& this.topLevelSymbols[name].symbol.kind !== lsp.SymbolKind.Function
				&& this.topLevelSymbols[name].symbol.kind !== lsp.SymbolKind.Class) {
				sortedSymbolNames.push(name)
			}
		})

		return sortedSymbolNames
	}

	/**
	 * Combines all the top level code and symbol definition strings
	 * into one large string representing the entire context/file.
	 *
	 * @returns entire file
	 */
	getLinearizedCode(): string { // TODO
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
