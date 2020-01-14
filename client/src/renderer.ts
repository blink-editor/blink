// This file is required by the index.html file and will
// be executed in the renderer process for that window.
// No Node.js APIs are available in this process because
// `nodeIntegration` is turned off. Use `preload.js` to
// selectively enable features needed in the rendering
// process.

const globals: Globals = window["globals"]

let file = `def firstFunction():
    print("first")


def secondFunction():
    print("second")


def thirdFunction():
    print("third")


def main():
    firstFunction()
    secondFunction()
    thirdFunction()


def test():
    main()
`

const extractRangeOfFile = (range): string => {
	const allLines = file.split("\n")

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

const applyFileChange = (change) => {
	const startString = extractRangeOfFile({ start: { line: 0, character: 0, }, end: change.range.start })

	const allLines = file.split("\n")
	const lastLine = allLines[allLines.length - 1]
	const endString = extractRangeOfFile({ start: change.range.end, end: { line: allLines.length - 1, character: lastLine.length } })

	file = startString + change.text + endString

	return file
}

// TODO: use better polyfill
;(window as any).setImmediate = function(callback: (...args: any[]) => void) {
	window.setTimeout(callback, 0)
}

class PaneObject {
	paneEditor: CodeMirror.Editor
	context: string
}

class Editor {
	calleePanes: [PaneObject, PaneObject, PaneObject]
	callerPanes: [PaneObject, PaneObject, PaneObject]

	activeEditorPane: PaneObject

	activeSymbol: any | null = null
	activeEditorOwnedRange: any | null
	calleesOfActive: any[] = []
	callersOfActive: any[] = []

	constructor() {
		// creates a CodeMirror editor configured to look like a preview pane
		const createPane = function(id, wrapping): PaneObject {
			const pane = new PaneObject()
			pane.paneEditor = globals.CodeMirror(document.getElementById(id), {
					mode: "python",
					lineNumbers: true,
					theme: "monokai",
					readOnly: "nocursor",
					lineWrapping: wrapping
				})

			pane.paneEditor.setSize("100%", "192.33px");

			pane.context = "TBA"

			return pane
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
			pane.on("mousedown", () => {
				if (pane.paneEditor.getValue() !== "") {
					this.swapToCallee(index)
				}
			})
		})
		this.callerPanes.forEach((pane, index) => {
			pane.paneEditor.on("mousedown", () => {
				if (pane.paneEditor.getValue() !== "") {
					this.swapToCaller(index)
				}
			})
		})

		// create active editor pane
		this.activeEditorPane = globals.CodeMirror(document.getElementById("main-pane"), {
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
		this.activeEditorPane.paneEditor.setSize("100%", "46.84em")

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
		console.log("connecting to server")

		globals.ConfigureEditorAdapter(
			this.activeEditorPane,
			file,
			this.onFileChanged.bind(this),
			() => this.activeEditorOwnedRange?.start.line ?? 0,
			this.onNavObjectUpdated.bind(this),
			(sym) => {
				this.swapToSymbol(sym)
			}
		)

		// kick off reanalysis to find main initially
		if (globals.clientInitialized) {
			globals.Reanalyze()
		} else {
			globals.events.once("client-initialized", () => {
				globals.Reanalyze()
			})
		}
	}

	/**
	 * Called by the CodeMirror adapter when the contents of the
	 * the active editor pane have changed.
	 *
	 * @param text  The changed contents of the active editor pane.
	 */
	onFileChanged(text) {
		if (!this.activeEditorOwnedRange) {
			return file
		}

		const oldLineCount = file.split("\n").length

		// replace the contents of the symbol's range with the new contents
		file = applyFileChange({
			range: this.activeEditorOwnedRange,
			text: text
		})

		// if the number of lines occupied changes, fix up the known location
		// of the symbol so that e.g. the above substitution range is correct
		const newLineCount = file.split("\n").length
		if (newLineCount !== oldLineCount) {
			// TODO: maybe reanalyze
			// setTimeout(() => {
			// 	globals.reanalyze()
			// }, 1000)
			this.activeEditorOwnedRange.end.line += (newLineCount - oldLineCount)
		}

		// if the number of characters on the last line changes, fix up known location
		// of the symbol so that e.g. the above substitution range is correct
		const textLines = text.split("\n")
		this.activeEditorOwnedRange.end.character = textLines[textLines.length - 1].length

		return file
	}

	/**
	 * Called by the CodeMirror adapter when the nav object's symbol cache
	 * is updated.
	 *
	 * @param lookup  A method that can look up symbols in the new nav object.
	 */
	onNavObjectUpdated(lookup) {
		// a `SymbolKey` that represents the main function
		const mainKey = {
			name: "main",
			kind: 12, // lsp.SymbolKind.Function
			module: "", // TODO
		}

		let symbol

		if (this.activeSymbol) {
			// if we have an active symbol, try to look up its new version
			const activeSymbolKey = {
				name: this.activeSymbol.name,
				kind: 12, // TODO
				module: "", // TODO
			}

			const activeSymbol = lookup(activeSymbolKey)

			if (activeSymbol && activeSymbolKey != mainKey) {
				// if we found the updated version, good
				symbol = activeSymbol
			} else {
				const keystr = JSON.stringify(activeSymbolKey)
				console.log(`did not find active symbol with key ${keystr}, trying main`)

				// otherwise, try to look up and go back to `main`
				symbol = lookup(mainKey)
			}
		} else {
			// otherwise, start by looking up main
			symbol = lookup(mainKey)
		}

		if (symbol) {
			// we got a symbol, be it the active one or main
			console.log("reanalyzed and obtained new active symbol", symbol)
			this.swapToSymbol(symbol)
		} else {
			// we did not find the active symbol or main
			const keystr = JSON.stringify(mainKey)
			console.error(`no main symbol detected for key ${keystr}`)
		}
	}

	swapToCallee(index) {
		if (index >= this.calleesOfActive.length) {
			return
		}

		this.swapToSymbol(this.calleesOfActive[index])
	}

	swapToCaller(index) {
		if (index >= this.callersOfActive.length) {
			return
		}

		this.swapToSymbol(this.callersOfActive[index])
	}

	swapToSymbol(symbol) {
		// fetch new callees
		const contents = extractRangeOfFile(symbol.location.range)
		const callees = globals.FindCallees(contents)

		// fetch new callers
		const callers = globals.FindCallers({
			textDocument: { uri: symbol.location.uri },
			position: { line: symbol.location.range.start.line, character: 5 }, // TODO: not hardcode
		})

		// don't update any panes / props until done
		Promise.all([callees, callers])
			.then(([callees, callers]) => {
				// newly active function is switched to
				this.activeSymbol = symbol
				this.activeEditorOwnedRange = JSON.parse(JSON.stringify(symbol.location.range))

				// new callers/callees are fetched ones
				this.calleesOfActive = callees
				this.callersOfActive = callers

				// populate panes
				this.activeEditorPane.paneEditor.setValue(contents)
				this.calleePanes.forEach((pane) => pane.paneEditor.setValue(""))
				callees.slice(null, 3).forEach((calleeSym, index) => {
					this.calleePanes[index].paneEditor.setValue(extractRangeOfFile(calleeSym.location.range))
				})
				this.callerPanes.forEach((pane) => pane.paneEditor.setValue(""))
				callers.slice(null, 3).forEach((callerSym, index) => {
					this.callerPanes[index].paneEditor.setValue(extractRangeOfFile(callerSym.location.range))
				})
			})
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

			file = text
			editor.activeSymbol = null
			editor.activeEditorOwnedRange = null
			;(window as any).ChangeFile(file)
		})
}

function saveFile() {
	;(window as any).openSaveDialogForEditor(file)
		.then((result) => {
			if (result) {
				console.log("Successfully saved file")
			}
		})
}


function swapDisplayedContextToPath(pane, path) {

}

function displayContexts(panes, paths) {
	for (let i = 0; i < panes.length; i++) {
	  panes[i].contextBanner.textContent = "/Users/benjaminshapiro/Dev/blink_capstone/blink/client" // textOfSize(panes[i].size, paths[i])
	} 
}

function textOfSize(size, path) {
	// takes a path and formats it for a given size in pixels
}


