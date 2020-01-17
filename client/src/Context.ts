import * as lsp from "vscode-languageserver-protocol"
import { SymbolInfo } from "./nav-object"

export class Context{
	// TODO: add topLevelCode & topLevelSymbols
	// TODO: get rid of save
	// TODO: add linerize function
	private _name: string
	private _filePath: string
	private _hasChanges: boolean
	private _fileString: string
	public topLevelSymbols: { [name: string]: { symbol: SymbolInfo; definitionString: string } }
	private _topLevelCode: string | null

	constructor(name: string, filePath: string, fileString: string){
		this._name = name
		this._filePath = filePath
		this._hasChanges = false
		this._fileString = fileString
		this._topLevelCode = null
		this.topLevelSymbols = {}
	}

	get filePath(){
		return this._filePath
	}
	set filePath(newPath: string){
		this._filePath = newPath

		// TODO: set name to folder name and not entire path
		this._name = newPath
	}

	get name(){
		return this._name
	}

	get fileString(){
		return this._fileString
	}
	set fileString(newFileString: string){
		this._hasChanges = true
		this._fileString = newFileString
	}

	get hasChanges(){
		return this._hasChanges
	}
	set hasChanges(hasChanges: boolean){
		this._hasChanges = hasChanges
	}

	get topLevelCode(){
		return this._topLevelCode
	}
	set topLevelCode(newTopLevelCode: string | null){
		this._topLevelCode = newTopLevelCode
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
	splitFileBySymbols(file: string, topLevelSymbols: any[]): [string, { [name: string]: { symbol: SymbolInfo; definitionString: string } }] {
		// TODO: ensure top level symbol ranges are non-overlapping

		const topLevelSymbolsWithStrings: { [name: string]: { symbol: SymbolInfo; definitionString: string } } = topLevelSymbols
			.map((symbol) => { return {
				symbol: symbol,
				definitionString: this.extractRangeOfFile(this.fileString, symbol.range)
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


	extractRangeOfFile(file, range): string {
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




}
