import * as lsp from "vscode-languageserver-types"
import { RayBensSymbolInformation } from "./langserver-client"

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

export interface DisplaySymbolTree {
	// jqtree
	name: string
	id: any
	children?: DisplaySymbolTree[]
	// our custom stuff
	rayBensSymbol?: { documentHandle: Document, path: number[], context: Context }
}

export interface Chunk {
	contents: string
	lineOffset: number
}

export interface DocumentData {
	/*
	 * A chunk is a segment of code containing multiple symbol definitions
	 * as well as the top level code preceding the first symbol in the chunk.
	 *
	 * The last chunk in `chunks` is the top level code after all definitions.
	 *
	 * Chunks are stored in sorted order at all times.
	 */
	readonly chunks: Chunk[]

	/*
	 * All the top level symbols within this context.
	 */
	readonly topLevelSymbols: lsp.DocumentSymbol[]

	/*
	 * Associates an index in `topLevelSymbols` to the index in `chunks`
	 * where the corresponding symbol is defined.
	 */
	readonly symbolIndexToChunkIndex: Map<number, number>

	readonly usedSymbols: RayBensSymbolInformation[]
}

export interface Document {
	readonly file: string
	readonly version: number // TODO?
	data: DocumentData | undefined
	saved: boolean
}

export interface SymbolReference {
	readonly documentHandle: Document
	readonly path: number[]
}

export class Context {
	public readonly uri: string
	private _moduleName: string | undefined = undefined
	private _currentDocument: Document
	private latestSymbolVersion: number = -1

	constructor(uri: string, initialContents: string) {
		this.uri = uri

		this._currentDocument = {
			file: initialContents,
			version: 0,
			data: undefined,
			saved: true,
		}
	}

	/*
	 * Returns the current Document data for this context.
	 * Do not modify this document in any way outside of the context.
	 */
	get currentDocument(): Document {
		return this._currentDocument
	}

	get moduleName(): string | undefined {
		return this._moduleName
	}

	get hasChangedSinceUpdate(): boolean {
		return this._currentDocument.data === undefined
	}

	chunkForSymbol(symbolRef: SymbolReference): Chunk | undefined {
		const document = symbolRef.documentHandle
		const topLevelParentSymbolIndex = symbolRef.path[0]
		// if this symbolRef exists, it must have come from this document
		const chunkIndex = document.data!.symbolIndexToChunkIndex.get(topLevelParentSymbolIndex)!
		return document.data!.chunks[chunkIndex]
	}

	previewForSymbol(symbolRef: SymbolReference): [SymbolReference, string] {
		if (symbolRef.documentHandle.version !== this._currentDocument?.version) {
			// TODO: when will this happen? does it matter?
			console.warn(`document version mismatch (preview): ${symbolRef.documentHandle.version} vs ${this._currentDocument.version}`)
		}

		let symbolInfo = this.resolveSymbolReference(symbolRef)

		// if symbolRef is a nested variable, return its parent
		if (symbolInfo.kind === lsp.SymbolKind.Variable && symbolRef.path.length > 1) {
			symbolRef = { ...symbolRef, path: symbolRef.path.slice(0, -1) }
			symbolInfo = this.resolveSymbolReference(symbolRef)
		}

		return [symbolRef, extractRangeOfFile(symbolRef.documentHandle.file, symbolInfo.range)]
	}

	private _resolveSymbolPath(path: number[], topLevelSymbols: lsp.DocumentSymbol[]): lsp.DocumentSymbol | undefined {
		const lastComponentIndex = path.length - 1
		return path.reduce((acc, cur, i) => {
			if (i === lastComponentIndex) { return acc[cur] }
			return acc[cur].children
		}, topLevelSymbols) as lsp.DocumentSymbol
	}

	resolveSymbolReference(symbolRef: SymbolReference): lsp.DocumentSymbol {
		if (symbolRef.documentHandle.version !== this._currentDocument?.version) {
			// TODO: when will this happen? does it matter?
			console.warn(`document version mismatch (resolve): ${symbolRef.documentHandle.version} vs ${this._currentDocument.version}`)
		}

		// if the symbolRef comes from this document, it must have data now
		const topLevelSymbols = symbolRef.documentHandle.data!.topLevelSymbols
		// if this symbolRef exists, it must have come from this document
		return this._resolveSymbolPath(symbolRef.path, topLevelSymbols)!
	}

	upgradeSymbolReference(symbolRef: SymbolReference): SymbolReference | undefined {
		if (symbolRef.documentHandle.version === this._currentDocument?.version) {
			return symbolRef
		}

		if (!this._currentDocument?.data) {
			console.error("attempted to upgradeSymbolReference before context document has symbols")
			return undefined
		}

		// if the symbolRef comes from this document, it must have data now
		const oldDocumentSymbols = symbolRef.documentHandle.data!.topLevelSymbols
		const oldPath = symbolRef.path
		const oldSymbol = this._resolveSymbolPath(oldPath, oldDocumentSymbols)!

		const newDocumentSymbols = this._currentDocument.data.topLevelSymbols
		const newSymbolAtPath = this._resolveSymbolPath(oldPath, newDocumentSymbols)
		if (newSymbolAtPath && newSymbolAtPath.kind === oldSymbol.kind) {
			// assume it's the same symbol; just upgrade the document
			return { path: oldPath, documentHandle: this._currentDocument }
		}

		// TODO: smarter heuristics for finding a new version of the symbol?
	}

	/**
	 * Updates the known definition string of the given symbol
	 * with the provided definition string.
	 *
	 * Sets `currentDocument` accordingly.
	 *
	 * @param symbol     The symbol to update
	 * @param definition The new symbol definition body
	 */
	updateChunkDefinition(symbolRef: SymbolReference, newContents: string): void {
		const previousDocument = symbolRef.documentHandle

		// it's fine if the previous document is not the same as our document
		// (our document may have a symbol request in-flight),
		// but if it's an old symbol then it is a programming error to update using it
		if (previousDocument.version < this.latestSymbolVersion) {
			console.error("attempted to update symbol that is out of date")
			return
		}

		const topLevelParentSymbolIndex = symbolRef.path[0]
		// if this symbolRef exists, it must have come from this document
		const editedChunkIndex = previousDocument.data!.symbolIndexToChunkIndex.get(topLevelParentSymbolIndex)!

		const newChunkContents = previousDocument.data!.chunks
			.map((chunk, i) => (i === editedChunkIndex) ? newContents : chunk.contents)

		const newFile = newChunkContents.join("")

		const newDocument: Document = {
			file: newFile,
			version: this._currentDocument.version + 1,
			data: undefined,
			saved: false,
			// TODO: we could have a linked list of documents if we want 👀
			// parent: previousDocument,
		}

		this._currentDocument = newDocument
	}

	replaceEntireFile(previousDocument: Document | null, newFile: string) {
		// it's fine if the previous document is not the same as our document
		// (our document may have a symbol request in-flight),
		// but if it's an old symbol then it is a programming error to update using it
		if (previousDocument && previousDocument.version < this.latestSymbolVersion) {
			console.error("attempted to update symbol that is out of date")
			return
		}

		const newDocument: Document = {
			file: newFile,
			version: this._currentDocument.version + 1,
			data: undefined,
			saved: false,
			// TODO: we could have a linked list of documents if we want 👀
			// parent: previousDocument,
		}

		this._currentDocument = newDocument
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
	 * @param topLevelSymbols sorted array of top-level (no parent container) symbols
	 *
	 * @returns [top level code string, top-level definition strings by symbol name]
	 */
	private static splitFileBySymbols(file: string, topLevelSymbols: lsp.DocumentSymbol[]): [Chunk[], Map<number, number>] {
		// inclusive
		let currentChunkStart = 0
		let lastChunkEnd: number | null = null

		const chunks: Chunk[] = []
		const symbolIndexToChunkIndex: Map<number, number> = new Map()

		for (const [symbolIndex, currentSymbol] of topLevelSymbols.entries()) {
			if ((lastChunkEnd !== null) && (currentSymbol.range.start.line > lastChunkEnd)) {
				chunks.push({
					contents: extractRangeOfFile(file, {
						start: { line: currentChunkStart, character: 0 },
						end: { line: lastChunkEnd + 1, character: 0 },
					}),
					lineOffset: currentChunkStart
				})

				// new chunk started

				currentChunkStart = lastChunkEnd + 1

				symbolIndexToChunkIndex.set(symbolIndex, chunks.length)

				if (currentSymbol.range.end.character === 0) {
					lastChunkEnd = currentSymbol.range.end.line - 1
				} else {
					lastChunkEnd = currentSymbol.range.end.line
				}
			} else {
				symbolIndexToChunkIndex.set(symbolIndex, chunks.length)

				if (lastChunkEnd === null) {
					if (currentSymbol.range.end.character === 0) {
						lastChunkEnd = currentSymbol.range.end.line - 1
					} else {
						lastChunkEnd = currentSymbol.range.end.line
					}
				}
			}
		}

		// add the last chunk containing a symbol
		if (lastChunkEnd) {
			chunks.push({
				contents: extractRangeOfFile(file, {
					start: { line: currentChunkStart, character: 0 },
					end: { line: lastChunkEnd + 1, character: 0 },
				}),
				lineOffset: currentChunkStart
			})

			currentChunkStart = lastChunkEnd + 1
		}

		// add the remainder of the file (top level code)
		const lastLine = file.split("\n").length - 1 // TODO: line endings
		chunks.push({
			contents: extractRangeOfFile(file, {
				start: { line: currentChunkStart, character: 0 },
				end: { line: lastLine + 1, character: 0 },
			}),
			lineOffset: currentChunkStart
		})

		return [chunks, symbolIndexToChunkIndex]
	}

	/**
	 * Called when the nav object's symbol cache is updated.
	 *
	 * @param fileString The file these symbols are from
	 * @param symbols    The top-level hierarchical symbols
	 */
	updateWithDocumentSymbols(document: Document, [docSymbols, usedSymbols]: [lsp.DocumentSymbol[], RayBensSymbolInformation[]]) {
		// ensure top level symbols are sorted by occurrence
		docSymbols
			.sort((a, b) => {
				if (a.range.start.line < b.range.start.line) return -1
				if (a.range.start.line > b.range.start.line) return 1

				// symbols that end later come sooner if they start on the same line
				if (a.range.end.line > b.range.end.line) return -1
				if (a.range.end.line < b.range.end.line) return 1

				if (a.range.start.character < b.range.start.character) return -1
				if (a.range.start.character > b.range.start.character) return 1

				if (a.range.end.character > b.range.end.character) return -1
				if (a.range.end.character < b.range.end.character) return 1

				return 0
			})

		// set module name if not yet computed
		// TODO: move this?
		if (this._moduleName === undefined) {
			this._moduleName = docSymbols[0]?.["rayBensModule"]
		}

		// recompute the chunk strings containing the definition of each symbol
		const [chunks, symbolIndexToChunkIndex] =
			Context.splitFileBySymbols(document.file, docSymbols)

		const documentData: DocumentData = {
			chunks: chunks,
			topLevelSymbols: docSymbols,
			symbolIndexToChunkIndex: symbolIndexToChunkIndex,
			usedSymbols: usedSymbols,
		}

		console.assert(document.data === undefined)

		document.data = documentData

		if (document.version > this.latestSymbolVersion) {
			this.latestSymbolVersion = document.version
		}
	}

	findStartingSymbol(document: Document): SymbolReference | undefined {
		if (document.version !== this._currentDocument.version) {
			// TODO: when will this happen? does it matter?
			console.warn(`document version mismatch (starting): ${document.version} vs ${this._currentDocument.version}`)
		}

		console.assert(document.data !== undefined)
		const data = document.data!

		let firstFunctionIndex: number | undefined
		let firstNonImportIndex: number | undefined

		for (const [i, symbol] of data.topLevelSymbols.entries()) {
			// prefer returning "main" - if we find it we can stop searching
			if (symbol.name === "main" && symbol.kind === lsp.SymbolKind.Function) {
				return { documentHandle: document, path: [i] }
			}

			if (symbol.kind === lsp.SymbolKind.Function) {
				firstFunctionIndex = i
			}

			if (symbol.kind !== lsp.SymbolKind.Module) {
				firstNonImportIndex = i
			}
		}

		// our second preference is any function. find the first one.
		if (firstFunctionIndex) {
			return { documentHandle: document, path: [firstFunctionIndex] }
		}

		// our last preference is any symbol that isn't an import.
		if (firstNonImportIndex) {
			return { documentHandle: document, path: [firstNonImportIndex] }
		}

		// otherwise just return the first symbol
		if (data.topLevelSymbols.length > 0) {
			return { documentHandle: document, path: [0] }
		}

		return undefined
	}

	/**
	 * Finds the innermost containing symbol for a given location, if any
	 *
	 * @param loc location of desired symbol
	 */
	bestSymbolForLocation(document: Document, location: lsp.Range): SymbolReference | undefined {
		if (document.version !== this._currentDocument.version) {
			// TODO: when will this happen? does it matter?
			console.warn(`document version mismatch (bestForLocation): ${document.version} vs ${this._currentDocument.version}`)
		}

		console.assert(document.data !== undefined)
		const data = document.data!

		const isRangeWithin = (child: lsp.Range, parent: lsp.Range): boolean => {
			return (child.start.line >= parent.start.line
					|| ((child.start.line === parent.start.line) && (child.start.character >= parent.start.character)))
				&& (parent.end.line > ((child.end.line === 0) ? (child.end.line - 1) : child.end.line)
					|| ((parent.end.line === child.end.line) && (parent.end.character >= child.end.character)))
		}

		const findParentOfRange = (
			symbols: lsp.DocumentSymbol[],
			path: number[],
			range: lsp.Range,
			bestSymbolPath: number[] | undefined,
			bestScore: number | undefined
		): [number[] | undefined, number | undefined] => {
			if (!symbols) {
				return [bestSymbolPath, bestScore]
			}

			// search for tightest enclosing scope for this reference
			for (const [i, symbol] of symbols.entries()) {
				const thisPath = path.concat([i])
				// test if symbol is the tightest known bound around range
				const score = symbol.range.end.line - symbol.range.start.line
				if (isRangeWithin(range, symbol.range) && (bestScore === undefined || score < bestScore)) {
					bestScore = symbol.range.end.line - symbol.range.start.line
					bestSymbolPath = thisPath
				}
				// test if children have tighter bound
				if (symbol.children) {
					const [bestChildSymbol, bestChildScore] = findParentOfRange(symbol.children, thisPath, location, bestSymbolPath, bestScore)

					if (bestScore === undefined || (bestChildScore !== undefined && bestChildScore < bestScore)) {
						bestScore = bestChildScore
						bestSymbolPath = bestChildSymbol
					}
				}
			}

			return [bestSymbolPath, bestScore]
		}

		const [path, _] = findParentOfRange(data.topLevelSymbols, [], location, undefined, undefined)

		if (path) {
			return {
				documentHandle: document,
				path: path,
			}
		} else {
			return undefined
		}
	}

	/**
	 * Returns a tree of
	 */
	getDisplaySymbolTree(): DisplaySymbolTree[] {
		const symbolToTreeItem = (path: number[], symbol: lsp.DocumentSymbol): DisplaySymbolTree => {
			const symbolRef: SymbolReference = {
			 documentHandle: this.currentDocument,
			 path: path
			}
			return {
				rayBensSymbol: { ...symbolRef, context: this },
				name: symbol.name,
				id: symbol.detail,
				children: Array.from((symbol.children ?? [])
					.entries())
					.map(([i, symbol]) => symbolToTreeItem(path.concat([i]), symbol))
			}
		}

		return Array.from((this.currentDocument.data?.topLevelSymbols ?? [])
			.entries())
			.map(([i, symbol]) => symbolToTreeItem([i], symbol))
	}
}
