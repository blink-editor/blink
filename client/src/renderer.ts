// This file is required by the index.html file and will
// be executed in the renderer process for that window.

import * as fs from "fs"
import * as path from "path"
import { promisify } from "util"
import { URL as NodeURL, pathToFileURL } from "url"

import * as electron from "electron"
import CodeMirror from "codemirror"
import * as lsp from "vscode-languageserver-protocol"

import { Context } from "./Context"
import { Project } from "./Project"
import { CodeMirrorAdapter } from "./codemirror-adapter"
import { NavObject, SymbolInfo } from "./nav-object"
import * as client from "./langserver-client"

// css imported in html for now
// import "./codemirror-lsp.css"
import "codemirror/mode/python/python"
// import "codemirror/lib/codemirror.css"
// import "codemirror/theme/monokai.css"
import "codemirror/addon/hint/show-hint"
// import "codemirror/addon/hint/show-hint.css"

interface PaneObject {
	editor: CodeMirror.Editor
	context: HTMLElement
	symbol: SymbolInfo | null
}

class Editor {
	// program state
	lspClient: client.LspClient
	adapter: CodeMirrorAdapter
	navObject: NavObject

	// editor/project state
	calleePanes: [PaneObject, PaneObject, PaneObject]
	callerPanes: [PaneObject, PaneObject, PaneObject]

	navStack: SymbolInfo[] = []
	curNavStackIndex = 0

	activeEditorPane: PaneObject

	pendingSwap: SymbolInfo | null = null

	currentProject: Project = new Project("Untitled", "") // TODO

	constructor() {
		const replacePaneElement = (id) => (codemirror) => {
			const textarea = document.getElementById(id) as HTMLTextAreaElement
			textarea.classList.forEach((cls) => codemirror.classList.add(cls))
			codemirror.id = textarea.id
			textarea.parentNode!.replaceChild(codemirror, textarea)
		}

		// creates a CodeMirror editor configured to look like a preview pane
		const createPane = function(id, wrapping): PaneObject {
			const editor = CodeMirror(replacePaneElement(id), {
				mode: "python",
				lineNumbers: true,
				theme: "monokai",
				readOnly: "nocursor",
				lineWrapping: wrapping
			})

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
		const activeEditor = CodeMirror(replacePaneElement("main-pane"), {
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
				},
				'Cmd-S': (cm) => {
					this.saveFile()
				},
				'Cmd-1': (cm) => {
					this.swapToCallee(0)
				},
				'Cmd-2': () => {
					this.swapToCallee(1)
				},
				'Cmd-3': () => {
					this.swapToCallee(2)
				},
				'Cmd-4': () => {
					this.swapToCaller(0)
				},
				'Cmd-5': () => {
					this.swapToCaller(1)
				},
				'Cmd-6': () => {
					this.swapToCaller(2)
				},
				'Ctrl-S': (cm) => {
					this.saveFile()
				},
				'Ctrl-1': (cm) => {
					this.swapToCallee(0)
				},
				'Ctrl-2': () => {
					this.swapToCallee(1)
				},
				'Ctrl-3': () => {
					this.swapToCallee(2)
				},
				'Ctrl-4': () => {
					this.swapToCaller(0)
				},
				'Ctrl-5': () => {
					this.swapToCaller(1)
				},
				'Ctrl-6': () => {
					this.swapToCaller(2)
				},
				'Cmd-[': () => {
					this.navBack()
				},
				'Cmd-]': () => {
					this.navForward()
				},
				'Ctrl-[': () => {
					this.navBack()
				},
				'Ctrl-]': () => {
					this.navForward()
				},

			},
		})

		this.activeEditorPane = {
			editor: activeEditor,
			context: document.getElementById("main-pane-context")!,
			symbol: null,
		}

		// nag the main process to start the server for us if
		// the server isn't currently up for some reason.
		electron.ipcRenderer.once("server-connected", () => {
			this.connectToServer()
		})
		electron.ipcRenderer.send("try-starting-server")
	}

	/**
	 * Attempts to connect the editor to the language server.
	 */
	connectToServer() {
		const logger = new client.ConsoleLogger()

		client.createTcpRpcConnection("localhost", 2087, (connection) => {
			this.lspClient = new client.LspClientImpl(connection, undefined, logger)
			this.lspClient.initialize()

			this.navObject = new NavObject(this.lspClient)

			// The adapter is what allows the editor to provide UI elements
			this.adapter = new CodeMirrorAdapter(this.lspClient, this.navObject, {
				// UI-related options go here, allowing you to control the automatic features of the LSP, i.e.
				suggestOnTriggerCharacters: false
			}, this.activeEditorPane.editor)

			this.adapter.onChange = this.onFileChanged.bind(this)
			this.adapter.onShouldSwap = this.swapToSymbol.bind(this)
			this.adapter.getLineOffset = this.getFirstLineOfActiveSymbolWithinFile.bind(this)

			this.lspClient.once("initialized", () => {
				this.openDemoFile()
			})
		}, logger)
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

			const shouldUpdateStack = this.navStack.length === 0
			this.swapToSymbol(newActiveSymbol, shouldUpdateStack)
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
				const navObject = await this.AnalyzeUri(context.uri, context.fileString)
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

				const navObject = await this.AnalyzeUri(newContext.uri, contents)
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

	async swapToSymbol(rawSymbol: SymbolInfo, updateStack: boolean = true) {
		const context = (await this.retrieveContextForSymbol(rawSymbol))!
		const contextSymbol = context.topLevelSymbols[rawSymbol.name]
		const symbol = contextSymbol.symbol
		const contents = contextSymbol.definitionString

		if (updateStack) {
			// update the navStack
			if(this.curNavStackIndex != this.navStack.length -1 && this.navStack.length != 0){
				this.navStack.length = this.curNavStackIndex + 1
			}
			this.navStack.push(rawSymbol)
			this.curNavStackIndex = this.navStack.length - 1
		}

		// fetch new callees
		const calleesAsync = this.FindCallees(symbol)

		// TODO: make this language-agnostic
		// determine where the cursor should be before the name of the symbol
		const nameStartPos =
			(symbol.kind === 5 /* SymbolKind.Class */) ? 6 // class Foo
			: (symbol.kind === 13 /* SymbolKind.Variable */) ? 0 // foo = 5
			: (symbol.kind === 14 /* SymbolKind.Constant */) ? 0 // foo = 5
			: 4 // def foo

		// fetch new callers
		const callersAsync = this.FindCallers({
			textDocument: { uri: symbol.uri },
			position: { line: symbol.range.start.line, character: nameStartPos },
		})

		// don't update any panes / props until done
		const [callees, callers] = await Promise.all([calleesAsync, callersAsync])

		// populate panes
		this.activeEditorPane.symbol = symbol
		this.activeEditorPane.editor.setValue(contents)
		this.activeEditorPane.context.textContent = context.name

		// change which file we're tracking as "currently editing"
		this.ChangeOwnedFile(context.uri, context.fileString)

		// new callers/callees are fetched ones
		for (let i = 0; i < 3; i++) {
			const assignSymbols = async (symbols, panes) => {
				let paneSymbolToSet: SymbolInfo | null = null
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
							paneContextStringToSet = `${paneContext.name},${paneContextSymbol.symbol.detail}`
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

	navBack() {
		if (this.navStack.length > 0 && this.curNavStackIndex > 0) {
			this.curNavStackIndex -= 1
			this.swapToSymbol(this.navStack[this.curNavStackIndex], false)
		} else {
			console.warn("cannot go back End Of Stack ")
		}
	}

	navForward() {
		if (this.navStack.length > 0 && this.navStack.length - 1 >= this.curNavStackIndex) {
			this.curNavStackIndex += 1
			this.swapToSymbol(this.navStack[this.curNavStackIndex], false)
		} else {
			console.warn("cannot go forward End Of Stack ")
		}
	}

	async setFile(text: string, fileDir: string) {
		this.pendingSwap = null
		this.activeEditorPane.symbol = null
		this.calleePanes.forEach((p) => p.symbol = null)
		this.callerPanes.forEach((p) => p.symbol = null)

		const uri = pathToFileURL(path.resolve(fileDir)).toString()
		const context = new Context("primary", uri, text) // TODO: name
		this.currentProject = new Project("Untitled", fileDir)

		// change file and kick off reanalysis to find main initially
		this.ChangeOwnedFile(context.uri, context.fileString)

		const navObject = await this.AnalyzeUri(context.uri, text)
		this.navigateToUpdatedSymbol(navObject)
	}

	// MARK: LSP/NavObject Interface

	FindCallees(symbol: SymbolInfo): Thenable<lsp.SymbolInformation[]> {
		return this.adapter.navObject.findCallees(symbol)
	}

	FindCallers(pos: lsp.TextDocumentPositionParams): Thenable<SymbolInfo[]> {
		return this.adapter.navObject.findCallers(pos)
	}

	ChangeOwnedFile = function(uri: string, contents: string): void {
		this.lspClient.openDocument({
			languageId: "python",
			documentUri: uri,
			initialText: contents,
		})
		// TODO: close old one? wait for open before changing adapter?
		this.adapter.changeOwnedFile(uri, contents)
	}

	/**
	 * Analyzes the document symbols in the given uri and updates the nav object.
	 *
	 * @param uri The uri of the file to analyze.
	 * @param contents The contents of the file. Only used when it has not been opened before.
	 */
	AnalyzeUri(uri: string, contents: string): Thenable<NavObject> {
		if (!this.lspClient.isDocumentOpen(uri)) {
			this.lspClient.openDocument({
				languageId: "python",
				documentUri: uri,
				initialText: contents,
			})
		}
		return this.lspClient.getDocumentSymbol(uri)
			.then((symbols) => {
				this.navObject.rebuildMaps(symbols ?? [], uri)
				return this.navObject
			})
	}

	// MARK: index.html Interface

	openFile() {
		const dialog = electron.remote.dialog

		return dialog.showOpenDialog({
			properties : ["openFile"]
		})
			.then((result) => {
				if (result.filePaths.length < 1) {
					return Promise.reject()
				}
				const dirPromise = Promise.resolve(result.filePaths[0])
				const fileTextPromise = promisify(fs.readFile)(result.filePaths[0], { encoding: "utf8" })
				return Promise.all([dirPromise, fileTextPromise])
			})
			.then(([filePath, contents]) => {
				this.setFile(contents, filePath)
			})
	}

	/**
	 * loop through all contexts and save them
	 */
	saveFile() {
		this.currentProject.contexts.forEach((context) => {
			if (!context.hasChanges) { return }

			const hasPath = context.uri !== null

			if (hasPath) {
				promisify(fs.writeFile)(new NodeURL(context.uri), context.fileString, { encoding: "utf8" })
			} else {
				const dialog = electron.remote.dialog

				return dialog.showSaveDialog({})
					.then((result) => {
						if (!result.filePath) {
							return Promise.reject()
						}

						return promisify(fs.writeFile)(result.filePath, context.fileString, { encoding: "utf8" })
					})
			}
		})
	}
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const editor = new Editor()
