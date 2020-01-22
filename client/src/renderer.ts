// This file is required by the index.html file and will
// be executed in the renderer process for that window.
// No Node.js APIs are available in this process because
// `nodeIntegration` is turned off. Use `preload.js` to
// selectively enable features needed in the rendering
// process.

import { Context } from "./Context"
import { Project } from "./Project"
import * as lsp from "vscode-languageserver-protocol"

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

interface PaneObject {
	editor: CodeMirror.Editor
	context: HTMLElement
	symbol: any | null
}

class Editor {
	calleePanes: [PaneObject, PaneObject, PaneObject]
	callerPanes: [PaneObject, PaneObject, PaneObject]

	activeEditorPane: PaneObject

	fresh = false
	pendingSwap: any | null = null

  defaultContext: Context = new Context("", globals.app.getAppPath(), "")
  currentProject: Project = new Project("Untitled", globals.app.getAppPath(), [this.defaultContext])

	constructor() {
		// creates a CodeMirror editor configured to look like a preview pane
		const createPane = function(id, wrapping): PaneObject {
			const editor = globals.CodeMirror(document.getElementById(id), {
					mode: "python",
					lineNumbers: true,
					theme: "monokai",
					readOnly: "nocursor",
					lineWrapping: wrapping
				})

			editor.setSize("100%", "192.33px");

			return {
				editor: editor,
				context: document.getElementById(id + "-context")!,
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

		activeEditor.setSize("100%", "46.84em")

		this.activeEditorPane = {
			editor: activeEditor,
			context: document.getElementById("main-pane-context")!,
			symbol: null,
		}

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
			initialFileText: this.currentProject.currentContext.fileString,
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
				this.setFile(sampleFileText ?? "", "samples/sample.py")
			})
	}

	/**
	 * Called by the CodeMirror adapter when the contents of the
	 * the active editor pane have changed.
	 *
	 * @param editorText  The changed contents of the active editor pane.
	 * @returns fileText  The text of the entire file.
	 */
	onFileChanged(text): string { // TODO: change file
		// update our knowledge of the active symbol
		this.currentProject.currentContext.topLevelSymbols[this.activeEditorPane.symbol.name].definitionString = text

		const oldFile = this.currentProject.currentContext.fileString
		const oldLineCount = oldFile.split("\n").length

		const newFile = this.currentProject.currentContext.getLinearizedCode()
		this.currentProject.currentContext.fileString = newFile

		if (newFile.split("\n").length !== oldLineCount) {
			this.fresh = false
		}

		return newFile
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

		for (const symbolName of this.currentProject.currentContext.getSortedTopLevelSymbolNames()) {
			if (symbolName === this.activeEditorPane.symbol.name) {
				found = true
				break
			}

			const symbol = this.currentProject.currentContext.topLevelSymbols[symbolName]
			const lineCount = symbol.definitionString.split("\n").length
			lineno += lineCount - 1
			lineno += 2 // add padding added by `linearizeContextCode`
		}

		console.assert(found)

		return lineno
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
			this.currentProject.currentContext.splitFileBySymbols(this.currentProject.currentContext.fileString, navObject.findTopLevelSymbols())

		// TODO: store this by context/file/module
		this.currentProject.currentContext.topLevelCode = topLevelCode
		this.currentProject.currentContext.topLevelSymbols = topLevelSymbolsWithStrings

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
		const contents = this.currentProject.currentContext.topLevelSymbols[symbol.name].definitionString

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
				for (let i = 0; i < 3; i++) {
					const calleePane = this.calleePanes[i]
					const callerPane = this.callerPanes[i]

					if (i < callees.length) {
						const calleeSym = callees[i]
						calleePane.symbol = calleeSym
						calleePane.editor.setValue(extractRangeOfFile(this.currentProject.currentContext.fileString, calleeSym.range))
						calleePane.context.textContent = calleeSym.detail
					} else {
						calleePane.symbol = null
						calleePane.editor.setValue("")
						calleePane.context.textContent = "(no context)"
					}

					if (i < callers.length) {
						const callerSym = callers[i]
						callerPane.symbol = callerSym
						callerPane.editor.setValue(extractRangeOfFile(this.currentProject.currentContext.fileString, callerSym.range))
						callerPane.context.textContent = callerSym.detail
					} else {
						callerPane.symbol = null
						callerPane.editor.setValue("")
						callerPane.context.textContent = "(no context)"
					}
				}
			})
	}

	setFile(text: string, fileDir: string) {
		this.fresh = false
		this.pendingSwap = null
		this.activeEditorPane.symbol = null
		this.calleePanes.forEach((p) => p.symbol = null)
		this.callerPanes.forEach((p) => p.symbol = null)

	  this.defaultContext = new Context("Untitled", fileDir, text)
	  this.currentProject = new Project("Untitled", fileDir, [this.defaultContext])

		// change file and kick off reanalysis to find main initially
		globals.ChangeFileAndReanalyze(this.currentProject.currentContext.fileString)
	}
}

const editor = new Editor()

// 1
function openFile() {
	;(window as any).openFileDialogForEditor()
		.then(fileInfo => {
			// 3
			if (!fileInfo) {
				console.error("Error: No file selected")
				return
			}

			editor.setFile(fileInfo[1], fileInfo[0] )
		})
}

/**
 * loop through all contexts and save them 
 */
function saveFile() {
  editor.currentProject.contexts.forEach( currContext => {
		console.log("Saving to ", currContext.filePath)
    if(currContext.hasChanges){
      if(currContext.name == '' || currContext.filePath == ''){
        (window as any).openSaveDialogForEditor(currContext.fileString)
          .then((result) => {
            if(result){
              currContext.hasChanges = false
              currContext.fileString = result
            }
          })
      }else{
        (window as any).saveWithoutDialog(currContext.fileString, currContext.filePath)
      }
    }
  })
}

function formatContext(sizeInEms, path) {
	// takes a path and formats it for a given size in pixels
	sizeInEms = Math.floor(sizeInEms)
	let filename = path.replace(/^.*[\\\/]/, '')
	// debugger
	if (sizeInEms >= path.length) {
		// debugger
		return path;
	} else if ((sizeInEms - 4) >= filename.length) {
		// debugger
		return (path.slice(0,(sizeInEms - 0 - filename.length))
			+ "..."
			+ filename);
	} else {
		// debugger
		return filename.slice(filename.length - sizeInEms);
	}

	return "TBAc"
}

