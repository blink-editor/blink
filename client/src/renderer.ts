// This file is required by the index.html file and will
// be executed in the renderer process for that window.

import * as fs from "fs"
import * as path from "path"
import { promisify } from "util"
import { URL as NodeURL } from "url"

import CodeMirror from "codemirror"
import * as lsp from "vscode-languageserver-protocol"

import { Context } from "./Context"
import { Project } from "./Project"
import { NavObject, SymbolInfo } from "./nav-object"

const globals: Globals = window["globals"]

// TODO: use better polyfill
;(window as any).setImmediate = function(callback: (...args: any[]) => void) {
	window.setTimeout(callback, 0)
}

interface PaneObject {
	editor: CodeMirror.Editor
	context: HTMLElement
	symbol: SymbolInfo | null
}

class Editor {
	calleePanes: [PaneObject, PaneObject, PaneObject]
	callerPanes: [PaneObject, PaneObject, PaneObject]

	activeEditorPane: PaneObject

	pendingSwap: SymbolInfo | null = null

	currentProject: Project = new Project("Untitled", "") // TODO

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
			onChange: this.onFileChanged.bind(this),
			getLineOffset: () => this.getFirstLineOfActiveSymbolWithinFile(),
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
		promisify(fs.readFile)("samples/sample.py", { encoding: "utf8" })
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
	onFileChanged(text): string {
		// TODO: when will these be null?
		const activeSymbol = this.activeEditorPane.symbol!
		const context = this.currentProject.contextForSymbol(activeSymbol)!

		// update our knowledge of the active symbol
		context.topLevelSymbols[activeSymbol.name].definitionString = text

		const newFile = context.getLinearizedCode()
		context.fileString = newFile

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

		const context = this.currentProject.contextForSymbol(this.activeEditorPane.symbol)

		if (!context) {
			// TODO: when will this happen?
			console.warn("no context found for active symbol")
			return 0
		}

		let lineno = 0
		let found = false

		for (const symbolName of context.getSortedTopLevelSymbolNames()) {
			if (symbolName === this.activeEditorPane.symbol.name) {
				found = true
				break
			}

			const symbol = context.topLevelSymbols[symbolName]
			const lineCount = symbol.definitionString.split("\n").length
			lineno += lineCount - 1
			lineno += 2 // add padding added by `linearizeContextCode`
		}

		console.assert(found)

		return lineno
	}

	swapToCallee(index) {
		if (index >= this.calleePanes.length) {
			return
		}

		this.swapToSymbol(this.calleePanes[index].symbol!)
	}

	swapToCaller(index) {
		if (index >= this.callerPanes.length) {
			return
		}

		this.swapToSymbol(this.callerPanes[index].symbol!)
	}

	navigateToUpdatedSymbol(navObject: NavObject) {
		//// navigate to the new version of the symbol the user was previously editing
		//// or main if we can't find it (or they had no previous symbol)

		const symbolToKey = (symbol: SymbolInfo) => { return {
			name: symbol.name,
			kind: symbol.kind,
			module: symbol.module
		} }

		let newActiveSymbol: SymbolInfo | null

		const toRestore: SymbolInfo | null = this.pendingSwap ?? this.activeEditorPane.symbol

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

	async retrieveContextForSymbol(symbol: SymbolInfo | lsp.SymbolInformation): Promise<Context | undefined> {
		// obtain the definition string of the new symbol
		const project = this.currentProject
		let context = project.contextForSymbol(symbol)

		// if we are not "fresh" - meaning the user has inserted newlines
		// then the line numbers for our caller and callee panes may be wrong
		// so we need to call Reanalyze() to get updated symbols, then swap.
		if (context && context.hasLineNumberChanges) {
			try {
				const navObject = await globals.AnalyzeUri(context.uri, context.fileString)
				context.updateWithNavObject(navObject)
				// TODO: this.pendingSwap
				// TODO: this.navigateToUpdatedSymbol
			} catch {
				console.warn("could not build update for symbol", symbol)
				return undefined
			}
		}

		// if the context wasn't found - meaning we haven't loaded this file
		// then go ahead and load up the file
		if (!context) {
			function isLspSymbolInformation(x: SymbolInfo | lsp.SymbolInformation): x is lsp.SymbolInformation {
				return (x as lsp.SymbolInformation).location !== undefined
			}

			const uri = isLspSymbolInformation(symbol) ? symbol.location.uri : symbol.uri
			// TODO: Create context module name automatically from filename?
			const symmodule = isLspSymbolInformation(symbol) ? "" : symbol.module

			const url = new NodeURL(uri)
			console.assert(url.protocol == "file:")

			try {
				const contents = await promisify(fs.readFile)(url, { encoding: "utf8" })
				const newContext = new Context(symmodule, uri, contents)

				const navObject = await globals.AnalyzeUri(newContext.uri, contents)
				newContext.updateWithNavObject(navObject)
				project.contexts.push(newContext)
				context = newContext
				// TODO: this.navigateToUpdatedSymbol
			} catch {
				console.warn("could not build context for symbol", symbol)
				return undefined
			}
		}

		return context
	}

	async swapToSymbol(rawSymbol: SymbolInfo) {
		const context = (await this.retrieveContextForSymbol(rawSymbol))!
		const contextSymbol = context.topLevelSymbols[rawSymbol.name]
		const symbol = contextSymbol.symbol

		const contents = contextSymbol.definitionString

		// fetch new callees
		const calleesAsync = globals.FindCallees(symbol)

		// TODO: make this language-agnostic
		// determine where the cursor should be before the name of the symbol
		const nameStartPos =
			(symbol.kind === 5 /* SymbolKind.Class */) ? 6 // class Foo
			: (symbol.kind === 13 /* SymbolKind.Variable */) ? 0 // foo = 5
			: (symbol.kind === 14 /* SymbolKind.Constant */) ? 0 // foo = 5
			: 4 // def foo

		// fetch new callers
		const callersAsync = globals.FindCallers({
			textDocument: { uri: symbol.uri },
			position: { line: symbol.range.start.line, character: nameStartPos },
		})

		// don't update any panes / props until done
		const [callees, callers] = await Promise.all([calleesAsync, callersAsync])

		// populate panes
		this.activeEditorPane.symbol = symbol
		this.activeEditorPane.editor.setValue(contents)

		// new callers/callees are fetched ones
		for (let i = 0; i < 3; i++) {
			const assignSymbols = async (symbols, panes) => {
				let paneSymbolToSet: any = null
				let paneContentToSet: string | null = null
				let paneContextStringToSet: string | null = null

				if (i < symbols.length) {
					const paneContext = await this.retrieveContextForSymbol(symbols[i])
					if (paneContext) {
						// TODO: find up-to-top-level symbol if this isn't a top-level symbol
						const paneContextSymbol = paneContext.topLevelSymbols[symbols[i].name]
						if (paneContextSymbol) {
							paneSymbolToSet = paneContextSymbol.symbol
							paneContentToSet = paneContextSymbol.definitionString
							paneContextStringToSet = `TODO,${paneContextSymbol.symbol.detail}`
						} else {
							paneContextStringToSet = `(${symbols[i].name}: not top level)`
							console.warn("did not find top-level symbol for", symbols[i], "in", paneContext)
						}
					} else {
						paneContextStringToSet = `(${symbols[i].name}: no matching context)`
					}
				}

				panes[i].symbol = paneSymbolToSet
				panes[i].editor.setValue(paneContentToSet ?? "")
				panes[i].context.textContent = paneContextStringToSet ?? "(no symbol)"
			}

			assignSymbols(callees, this.calleePanes)
			assignSymbols(callers, this.callerPanes)
		}
	}

	async setFile(text: string, fileDir: string) {
		this.pendingSwap = null
		this.activeEditorPane.symbol = null
		this.calleePanes.forEach((p) => p.symbol = null)
		this.callerPanes.forEach((p) => p.symbol = null)

		const context = new Context("primary", `file://${path.resolve(fileDir)}`, text) // TODO: name
		this.currentProject = new Project("Untitled", fileDir)

		// change file and kick off reanalysis to find main initially
		globals.ChangeOwnedFile(context.uri, context.fileString)

		const navObject = await globals.AnalyzeUri(context.uri, text)
		this.navigateToUpdatedSymbol(navObject)
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

			editor.setFile(fileInfo[1], fileInfo[0])
		})
}

/**
 * loop through all contexts and save them
 */
function saveFile() {
	/* TODO
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
  */
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
