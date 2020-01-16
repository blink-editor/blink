// This file is required by the index.html file and will
// be executed in the renderer process for that window.
// No Node.js APIs are available in this process because
// `nodeIntegration` is turned off. Use `preload.js` to
// selectively enable features needed in the rendering
// process.

const globals: Globals = window["globals"]

const extractRangeOfFile = (file, range): string => {
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

// TODO: use better polyfill
;(window as any).setImmediate = function(callback: (...args: any[]) => void) {
	window.setTimeout(callback, 0)
}

class PaneObject {
	editor: CodeMirror.Editor
	symbol: any | null
}

class Editor {
	calleePanes: [PaneObject, PaneObject, PaneObject]
	callerPanes: [PaneObject, PaneObject, PaneObject]

	activeEditorPane: PaneObject

	file: string = ""
	topLevelSymbols: { [name: string]: { symbol: any; definitionString: string } } = {}
	topLevelCode: string | null = null

	fresh = false
	pendingSwap: any | null = null

	constructor() {
		// creates a CodeMirror editor configured to look like a preview pane
		const createPane = function(id, wrapping): PaneObject {
			const pane = globals.CodeMirror(document.getElementById(id), {
				mode: "python",
				lineNumbers: true,
				theme: "monokai",
				readOnly: "nocursor",
				lineWrapping: wrapping
			})

			pane.setSize("100%", "200px")

			return {
				editor: pane,
				symbol: null,
			}
		}

		// create callee preview panes (top)
		this.calleePanes = [
			createPane("top-left-pane", true),
			createPane("top-mid-pane", true),
			createPane("top-right-pane", true),
		]

		// create caller preview panes (side)
		this.callerPanes = [
			createPane("side-top-pane", false),
			createPane("side-mid-pane", false),
			createPane("side-bottom-pane", false),
		]

		// configure click handlers for switching to panes
		this.calleePanes.forEach((pane, index) => {
			pane.editor.on("mousedown", () => {
				if (pane.editor.getValue() !== "") {
					this.swapToCallee(index)
				}
			})
		})
		this.callerPanes.forEach((pane, index) => {
			pane.editor.on("mousedown", () => {
				if (pane.editor.getValue() !== "") {
					this.swapToCaller(index)
				}
			})
		})

		// create active editor pane
		const activeEditor = globals.CodeMirror(document.getElementById("main-pane"), {
			mode: "python",
			lineNumbers: true,
			theme: "monokai",
			gutters: ["CodeMirror-linenumbers", "CodeMirror-lsp"],
			indentUnit: 4,
			indentWithTabs: false,
			extraKeys: {
				Tab: (cm) => {
					if (cm.somethingSelected()) cm.execCommand("indentMore")
					else cm.execCommand("insertSoftTab")
				}
			},
		})
		activeEditor.setSize("100%", "46.35em")

		this.activeEditorPane = { editor: activeEditor, symbol: null }

		// begin the connection to the server
		globals.TryStartingServer()

		if (globals.serverConnected) {
			this.connectToServer()
		} else {
			globals.events.once("server-connected", this.connectToServer.bind(this))
		}
	}

	/**
	 * Attempts to connect the editor to the language server.
	 */
	connectToServer() {
		globals.ConfigureEditorAdapter({
			editor: this.activeEditorPane.editor,
			initialFileText: this.file,
			onChange: this.onFileChanged.bind(this),
			getLineOffset: () => this.getFirstLineOfActiveSymbolWithinFile(),
			onReanalyze: this.onNavObjectUpdated.bind(this),
			onShouldSwap: (sym) => {
				this.swapToSymbol(sym)
			}
		})

		if (globals.clientInitialized) {
			this.openDemoFile()
		} else {
			globals.events.once("client-initialized", () => {
				this.openDemoFile()
			})
		}
	}

	openDemoFile() {
		globals.OpenSampleFile()
			.then((sampleFileText) => {
				console.assert(sampleFileText, "must load demo file text")
				this.setFile(sampleFileText ?? "")
			})
	}

	/**
	 * Called by the CodeMirror adapter when the contents of the
	 * the active editor pane have changed.
	 *
	 * @param editorText  The changed contents of the active editor pane.
	 * @returns fileText  The text of the entire file.
	 */
	onFileChanged(text): string {
		// update our knowledge of the active symbol
		this.topLevelSymbols[this.activeEditorPane.symbol.name].definitionString = text
		const oldLineCount = this.file.split("\n").length
		this.file = this.linearizeContextCode()
		if (this.file.split("\n").length !== oldLineCount) {
			this.fresh = false
		}
		return this.file
	}

	/**
	 * Combines all the top level code and symbol definition strings
	 * into one large string representing the entire context/file.
	 *
	 * @returns entire file
	 */
	linearizeContextCode(): string {
		return this._sortedTopLevelSymbolNames()
			.map((n) => this.topLevelSymbols[n].definitionString)
			.join("\n\n") + this.topLevelCode
	}

	/**
	 * Returns the line number of the beginning of the currently active symbol
	 * within the file string returned by `linearizeContextCode`.
	 *
	 * Called by the codemirror adapter to translate visual line numbers
	 * to actual language server protocol line numbers.
	 */
	getFirstLineOfActiveSymbolWithinFile(): number {
		if (!this.activeEditorPane.symbol) {
			return 0
		}

		let lineno = 0
		let found = false

		for (const symbolName of this._sortedTopLevelSymbolNames()) {
			if (symbolName === this.activeEditorPane.symbol.name) {
				found = true
				break
			}

			const symbol = this.topLevelSymbols[symbolName]
			const lineCount = symbol.definitionString.split("\n").length
			lineno += lineCount - 1
			lineno += 2 // add padding added by `linearizeContextCode`
		}

		console.assert(found)

		return lineno
	}

	_sortedTopLevelSymbolNames() {
		// sort the top level symbols by their original line number
		const symbolNames = Object.keys(this.topLevelSymbols)
		symbolNames.sort((a, b) => {
			const linea = this.topLevelSymbols[a].symbol.range.line
			const lineb = this.topLevelSymbols[b].symbol.range.line

			return (linea < lineb) ? -1
				: (linea > lineb) ? 1
				: 0
		})
		return symbolNames
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
	splitFileBySymbols(file: string, topLevelSymbols: any[]): [string, { [name: string]: { symbol: any; definitionString: string } }] {
		// TODO: ensure top level symbol ranges are non-overlapping

		const topLevelSymbolsWithStrings: { [name: string]: { symbol: any; definitionString: string } } = topLevelSymbols
			.map((symbol) => { return {
				symbol: symbol,
				definitionString: extractRangeOfFile(this.file, symbol.range)
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
	 * Called by the CodeMirror adapter when the nav object's symbol cache
	 * is updated. Also known as `onReanalyze`.
	 *
	 * @param navObject  The updated navObject
	 */
	onNavObjectUpdated(navObject) {
		//// recompute the strings containing the definition of each symbol

		const [topLevelCode, topLevelSymbolsWithStrings] =
			this.splitFileBySymbols(this.file, navObject.findTopLevelSymbols())

		// TODO: store this by context/file/module
		this.topLevelCode = topLevelCode
		this.topLevelSymbols = topLevelSymbolsWithStrings

		//// navigate to the new version of the symbol the user was previously editing
		//// or main if we can't find it (or they had no previous symbol)

		const symbolToKey = (symbol) => { return {
			name: symbol.name,
			kind: symbol.kind,
			module: symbol.rayBensModule
		} }

		let newActiveSymbol

		const toRestore = this.pendingSwap ?? this.activeEditorPane.symbol

		if (toRestore) {
			// if we have an active symbol, try to look up its new version
			const activeSymbolKey = symbolToKey(toRestore)
			const activeSymbol = navObject.findCachedSymbol(activeSymbolKey)

			if (activeSymbol) {
				// if we found the updated version, good
				newActiveSymbol = activeSymbol
			} else {
				const keystr = JSON.stringify(activeSymbolKey)
				console.log(`did not find active symbol with key ${keystr}, trying main`)

				// otherwise, try to look up and go back to `main`
				const mainFunctions = navObject.findMain()
				newActiveSymbol = mainFunctions ? mainFunctions[0] : null
			}
		} else {
			// otherwise, start by looking up main
			const mainFunctions = navObject.findMain()
			newActiveSymbol = mainFunctions ? mainFunctions[0] : null
		}

		this.fresh = true
		this.pendingSwap = null

		if (newActiveSymbol) {
			// we got a symbol, be it the active one or main
			console.log("reanalyzed and obtained new active symbol", newActiveSymbol)
			this.swapToSymbol(newActiveSymbol)
		} else {
			// we did not find the active symbol or main
			console.error("no main symbol detected")
		}
	}

	swapToCallee(index) {
		if (index >= this.calleePanes.length) {
			return
		}

		this.swapToSymbol(this.calleePanes[index].symbol)
	}

	swapToCaller(index) {
		if (index >= this.callerPanes.length) {
			return
		}

		this.swapToSymbol(this.callerPanes[index].symbol)
	}

	swapToSymbol(symbol) {
		// if we are not "fresh" - meaning the user has inserted newlines
		// then the line numbers for our caller and callee panes may be wrong
		// so we need to call Reanalyze() to get updated symbols, then swap.
		if (!this.fresh) {
			this.pendingSwap = symbol
			globals.Reanalyze()
			return
		}

		// obtain the definition string of the new symbol
		const contents = this.topLevelSymbols[symbol.name].definitionString

		// fetch new callees
		const callees = globals.FindCallees(symbol)

		// TODO: make this language-agnostic
		// determine where the cursor should be before the name of the symbol
		const nameStartPos =
			(symbol.kind === 5 /* SymbolKind.Class */) ? 6 // class Foo
			: (symbol.kind === 13 /* SymbolKind.Variable */) ? 0 // foo = 5
			: (symbol.kind === 14 /* SymbolKind.Constant */) ? 0 // foo = 5
			: 4 // def foo

		// fetch new callers
		const callers = globals.FindCallers({
			textDocument: { uri: symbol.uri },
			position: { line: symbol.range.start.line, character: nameStartPos },
		})

		// don't update any panes / props until done
		Promise.all([callees, callers])
			.then(([callees, callers]) => {
				// populate panes
				this.activeEditorPane.symbol = symbol
				this.activeEditorPane.editor.setValue(contents)

				// new callers/callees are fetched ones
				this.calleePanes.forEach((pane) => pane.editor.setValue(""))
				callees.slice(null, 3).forEach((calleeSym, index) => {
					this.calleePanes[index].symbol = calleeSym
					this.calleePanes[index].editor.setValue(extractRangeOfFile(this.file, calleeSym.range))
				})

				this.callerPanes.forEach((pane) => pane.editor.setValue(""))
				callers.slice(null, 3).forEach((callerSym, index) => {
					this.callerPanes[index].symbol = callerSym
					this.callerPanes[index].editor.setValue(extractRangeOfFile(this.file, callerSym.range))
				})
			})
	}

	setFile(text: string) {
		this.file = text
		this.fresh = false
		this.pendingSwap = null
		this.activeEditorPane.symbol = null
		this.calleePanes.forEach((p) => p.symbol = null)
		this.callerPanes.forEach((p) => p.symbol = null)
		this.topLevelSymbols = {}
		this.topLevelCode = null

		// change file and kick off reanalysis to find main initially
		globals.ChangeFileAndReanalyze(text)
	}
}

const editor = new Editor()

// 1
function openFile() {
	;(window as any).openFileDialogForEditor()
		.then((text: string | undefined) => {
			// 3
			if (!text) {
				console.error("Error: No file selected")
				return
			}

			editor.setFile(text)
		})
}

function saveFile() {
	;(window as any).openSaveDialogForEditor(editor.file)
		.then((result) => {
			if (result) {
				console.log("Successfully saved file")
			}
		})
}
