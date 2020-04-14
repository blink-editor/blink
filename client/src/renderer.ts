// This file is required by the index.html file and will
// be executed in the renderer process for that window.

import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { promisify } from "util"
import { URL as NodeURL, pathToFileURL, fileURLToPath } from "url"
import { spawn } from "child_process"

import * as electron from "electron"
import CodeMirror from "codemirror"
import * as lsp from "vscode-languageserver-protocol"

import { Context, DisplaySymbolTree } from "./Context"
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
	context: Element
	symbol: SymbolInfo | null
	isPinned: boolean
	pinImg: Element | null
}

interface NewSymbolInContext {
	context: Context
}

interface ActiveEditorPane {
	editor: CodeMirror.Editor
	context: Element
	symbol: SymbolInfo | NewSymbolInContext | null
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

	activeEditorPane: ActiveEditorPane

	calleesOfActive: lsp.SymbolInformation[] = []
	callersOfActive: SymbolInfo[] = []
	calleeIndex = 0
	callerIndex = 0

	projectStructureToggled: boolean = false

	currentProject: Project = new Project()

	constructor() {
		const replacePaneElement = (id) => (codemirror) => {
			const textarea = document.querySelector(`#${id} textarea`) as HTMLTextAreaElement
			textarea.classList.forEach((cls) => codemirror.classList.add(cls))
			codemirror.id = textarea.id
			textarea.parentNode!.replaceChild(codemirror, textarea)
		}

		// creates a CodeMirror editor configured to look like a preview pane
		const createPane = (id, wrapping): PaneObject => {
			const editor = CodeMirror(replacePaneElement(id), {
				mode: "python",
				lineNumbers: true,
				theme: "monokai",
				readOnly: "nocursor",
				lineWrapping: wrapping
			})

			const pane = {
				editor: editor,
				context: document.querySelector(`#${id} .context-label`)!,
				symbol: null,
				isPinned: false,
				pinImg: document.querySelector(`#${id} .pin-icon`)!
			}

			pane.pinImg.addEventListener("click", () => {
				this.togglePreviewPanePinned(pane)
			})

			return pane
		}

		// add listener for "Jump to Symbol by Name" feature
		this.addJumpToSymByNameListener()

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

		const MacKeyBindings = {
			"Cmd-[": () => this.navBack(),
			"Cmd-]": () => this.navForward(),
		}

		const WindowsKeyBindings = {
			"Ctrl-[": () => this.navBack(),
			"Ctrl-]": () => this.navForward(),
		}


		// create active editor pane
		const activeEditor = CodeMirror(replacePaneElement("main-pane"), {
			mode: "python",
			lineNumbers: true,
			theme: "monokai",
			gutters: ["CodeMirror-linenumbers", "CodeMirror-lsp"],
			indentUnit: 4,
			indentWithTabs: false,
			extraKeys: Object.assign({
				Tab: (cm) => {
					if (cm.somethingSelected()) cm.execCommand("indentMore")
					else cm.execCommand("insertSoftTab")
				}
			}, (process.platform === "darwin") ? MacKeyBindings : WindowsKeyBindings),

		})

		this.activeEditorPane = {
			editor: activeEditor,
			context: document.querySelector("#main-pane .context-label")!,
			symbol: null,
		}

		// nag the main process to start the server for us if
		// the server isn't currently up for some reason.
		electron.ipcRenderer.once("server-connected", () => {
			this.connectToServer()
		})
		electron.ipcRenderer.send("try-starting-server")

		// listen for keyboard shortcut events from the main process menu
		const onShortcut = (name, fn) => electron.ipcRenderer.on(name, fn)
		onShortcut("Open", () => this.openExistingProjectDialog())
		onShortcut("Save", () => this.saveFile())
		onShortcut("PanePageRight", () => this.panePageRight())
		onShortcut("PanePageLeft", () => this.panePageLeft())
		onShortcut("PanePageUp", () => this.panePageUp())
		onShortcut("PanePageDown", () => this.panePageDown())
		onShortcut("JumpPane1", () => this.swapToCallee(0))
		onShortcut("JumpPane2", () => this.swapToCallee(1))
		onShortcut("JumpPane3", () => this.swapToCallee(2))
		onShortcut("JumpPane4", () => this.swapToCaller(0))
		onShortcut("JumpPane5", () => this.swapToCaller(1))
		onShortcut("JumpPane6", () => this.swapToCaller(2))
		onShortcut("NavigateBack", () => this.navBack())
		onShortcut("navigateForward", () => this.navForward())
		onShortcut("JumpByName", () => this.openJumpToSymByName())
		onShortcut("Undo", () => this.activeEditorPane.editor.undo())
		onShortcut("Redo", () => this.activeEditorPane.editor.redo())
		onShortcut("SelectAll", () => {
			CodeMirror.commands.selectAll(this.activeEditorPane.editor)
		})
		onShortcut("NewProject", () => this.openCreateNewProjectDialog())
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

			this.adapter.onChange = this.onActiveEditorChanged.bind(this)
			this.adapter.onGoToLocation = this.goToLocation.bind(this)
			this.adapter.getLineOffset = this.getFirstLineOfActiveSymbolWithinFile.bind(this)

			this.lspClient.once("initialized", () => {
				this.openDemoFile()
			})
		}, logger)
	}

	async openDemoFile() {
		await this.activateProjectFromFile("samples/modules/game.py")
	}

	/**
	 * Called by the CodeMirror adapter when the contents of the
	 * the active editor pane have changed.
	 *
	 * @param editorText  The changed contents of the active editor pane.
	 */
	onActiveEditorChanged(text) {
		const activeSymbol = this.activeEditorPane.symbol
		if (!activeSymbol) { return }

		const isNewSymbol = (s: SymbolInfo | NewSymbolInContext): s is NewSymbolInContext =>
			(s as NewSymbolInContext).context !== undefined

		if (isNewSymbol(activeSymbol)) {
			const context = activeSymbol.context

			const lspCode = context.getLinearizedCode() + "\n\n" + text
			this.lspClient.sendChange(context.uri, { text: lspCode })
		} else {
			const context = this.currentProject.contextForSymbol(activeSymbol)!

			// update our knowledge of the active symbol
			context.updateSymbolDefinition(activeSymbol, text)

			// send the change to the server so it's up to date
			const lspCode = context.getLinearizedCode()
			this.lspClient.sendChange(context.uri, { text: lspCode })
		}

		// show save indicator
		;(document.querySelector("#save-button-indicator-group")! as HTMLDivElement)
			.classList.add("save-button-with-indicator")

		// we aren't performing reanalysis here because their code
		// may not be complete. wait until they save or swap panes
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

		const isNewSymbol = (s: SymbolInfo | NewSymbolInContext): s is NewSymbolInContext =>
			(s as NewSymbolInContext).context !== undefined

		if (isNewSymbol(this.activeEditorPane.symbol)) {
			return 0
		}

		const context = this.currentProject.contextForSymbol(this.activeEditorPane.symbol)!

		return context.getFirstLineOfSymbol(this.activeEditorPane.symbol)
	}

	async goToLocation(location: lsp.Location) {
		const context = await this.retrieveContextForUri(location.uri, null)
		if (!context) {
			console.warn("could not retrieve context for location", location)
			return
		}
		// TODO: ask context for symbol instead
		const locatedSymbol = this.navObject.bestSymbolForLocation(location)
		if (locatedSymbol) {
			this.swapToPossiblyNestedSymbol(locatedSymbol)
		}
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

	panePageUp() {
		const freePanes = this.calleePanes.filter((pane) => !pane.isPinned).length
		this.calleeIndex = Math.max(this.calleeIndex - freePanes, 0)
		this.updatePreviewPanes()
	}

	panePageDown() {
		const freePanes = this.calleePanes.filter((pane) => !pane.isPinned).length
		const maxIndex = Math.max(Math.floor((this.calleesOfActive.length - 1) / 3) * 3, 0)
		this.calleeIndex = Math.min(this.calleeIndex + freePanes, maxIndex)
		this.updatePreviewPanes()
	}

	panePageLeft() {
		const freePanes = this.callerPanes.filter((pane) => !pane.isPinned).length
		this.callerIndex = Math.max(this.callerIndex - freePanes, 0)
		this.updatePreviewPanes()
	}

	panePageRight() {
		const freePanes = this.callerPanes.filter((pane) => !pane.isPinned).length
		const maxIndex = Math.max(Math.floor((this.callersOfActive.length - 1) / 3) * 3, 0)
		this.callerIndex = Math.min(this.callerIndex + freePanes, maxIndex)
		this.updatePreviewPanes()
	}

	// opens prompt allowing user to fuzzy search for symbol and jump to it
	openJumpToSymByName() {
		(document.querySelector("#modal-container") as HTMLDivElement).style.display = "flex";
		(document.querySelector("#find-name-input") as HTMLInputElement).focus();
	}

	// closes prompt allowing user to fuzzy search for symbol and jump to it
	closeJumpToSymByName(event: MouseEvent) {
		// check that user clicked on #modal-container
		if ((event.target as HTMLElement).id === "modal-container")
			this.closeJumpToSymByNameUnconditional()
	}

	closeJumpToSymByNameUnconditional() {
		// close window
		(document.querySelector("#modal-container") as HTMLDivElement).style.display = "none"
		// clear input
		;(document.querySelector("#find-name-input") as HTMLInputElement).value = ""
		// clear results
		const list = document.querySelector("#find-name-result-list")!
		Array.from(list.children).forEach((e) => list.removeChild(e))
	}

	addJumpToSymByNameListener() {
		const nameInput = (document.querySelector("#find-name-input") as HTMLInputElement)
		nameInput.addEventListener("input", () => {
			// query string
			const query = nameInput.value

			// refresh results list
			const list = document.querySelector("#find-name-result-list")!
			Array.from(list.children).forEach((e) => list.removeChild(e))

			// make lsp call
			this.lspClient.getWorkspaceSymbols(query).then((results) => {
				results?.forEach((result: lsp.SymbolInformation, i) => {
					// only display first 12 results
					if (i > 11) { return }

					// add symbol to list of results
					const el = document.createElement("li")
					el.classList.add("response-list-item")
					el.innerText = result.name

					// use closure to specify which symbol to swap to when clicked
					el.addEventListener("click", () => {
						// swap to clicked symbol and close window
						this.swapToPossiblyNestedSymbol(result)
						this.closeJumpToSymByNameUnconditional()
					})

					list.appendChild(el)
				})
			})
		})
	}

	async retrieveContextForUri(uri: string, moduleName: string | null): Promise<Context | undefined> {
		// obtain the definition string of the new symbol
		const project = this.currentProject
		let context = project.contextForUri(uri)

		// if we are not "fresh" - meaning the user has inserted newlines
		// then the line numbers for our caller and callee panes may be wrong
		// so we need to call Reanalyze() to get updated symbols, then swap.
		//
		// also applies if this context is the context for an uninserted symbol
		const isNewSymbol = (s: SymbolInfo | NewSymbolInContext): s is NewSymbolInContext =>
			(s as NewSymbolInContext).context !== undefined
		const isContextForNewSymbol = this.activeEditorPane.symbol
			&& isNewSymbol(this.activeEditorPane.symbol)
			&& this.activeEditorPane.symbol.context.uri === context?.uri
		if (context && (context.hasLineNumberChanges || isContextForNewSymbol)) {
			try {
				await this.ReanalyzeContext(context)
			} catch {
				console.warn("could not build update for context", context)
				return undefined
			}
		}

		// if the context wasn't found - meaning we haven't loaded this file
		// then go ahead and load up the file
		if (!context) {
			const url = new NodeURL(uri)
			console.assert(url.protocol == "file:")

			try {
				const contents = await promisify(fs.readFile)(url, { encoding: "utf8" })

				const newContext = await this.AnalyzeForNewContext(uri, contents, moduleName)
				project.contexts.push(newContext)
				context = newContext
			} catch {
				console.warn("could not build context for uri", uri)
				return undefined
			}
		}

		return context
	}

	async retrieveContextForSymbol(symbol: SymbolInfo | lsp.SymbolInformation): Promise<Context | undefined> {
		function isLspSymbolInformation(x: SymbolInfo | lsp.SymbolInformation): x is lsp.SymbolInformation {
			return (x as lsp.SymbolInformation).location !== undefined
		}

		const uri = isLspSymbolInformation(symbol) ? symbol.location.uri : symbol.uri
		const symmodule = isLspSymbolInformation(symbol) ? (symbol as any)["rayBensModule"] : symbol.module

		return this.retrieveContextForUri(uri, symmodule)
	}

	async swapToSymbol(rawSymbol: SymbolInfo, updateStack: boolean = true) {
		// Compares two symbols by decreasing length in terms of number of lines the definition takes.
		const compareByLength = (a: lsp.SymbolInformation | SymbolInfo, b: lsp.SymbolInformation | SymbolInfo) => {
			function isSymbolInformation(sym: lsp.SymbolInformation | SymbolInfo): sym is lsp.SymbolInformation {
				return (sym as lsp.SymbolInformation).location !== undefined
			}

			let aLength: number = 0
			let bLength: number = 0

			if (isSymbolInformation(a)) {
				aLength = a.location.range.end.line - a.location.range.start.line + 1
			}
			else {
				aLength = a.range.end.line - a.range.start.line + 1
			}
			if (isSymbolInformation(b)) {
				bLength = b.location.range.end.line - b.location.range.start.line + 1
			}
			else {
				bLength = b.range.end.line - b.range.start.line + 1
			}

			// if builtin, goes at the end
			if ((a as any).rayBensModule === "builtins") {
				aLength = 0
			}
			if ((b as any).rayBensModule === "builtins") {
				bLength = 0
			}

			return bLength - aLength
		}

		const context = (await this.retrieveContextForSymbol(rawSymbol))!
		const contextSymbol = context.getTopLevelSymbol(rawSymbol.name)!
		const symbol = contextSymbol.symbol
		const contents = contextSymbol.definitionString

		if (updateStack) {
			// update the navStack
			if (this.curNavStackIndex != this.navStack.length -1 && this.navStack.length != 0) {
				this.navStack.length = this.curNavStackIndex + 1
			}
			this.navStack.push(rawSymbol)
			this.curNavStackIndex = this.navStack.length - 1
		}

		// fetch new callees and callers
		const calleesAsync = this.FindCallees(symbol)
		const callersAsync = this.FindCallers(symbol)

		// don't update any panes / props until done
		const [callees, callers] = await Promise.all([calleesAsync, callersAsync])

		// change which file we're tracking as "currently editing"
		// TODO: close old one?
		this.adapter.changeOwnedFile(context.uri)

		// populate panes
		this.activeEditorPane.symbol = symbol
		this.activeEditorPane.editor.setValue(contents ?? "")
		this.activeEditorPane.context.textContent = context.name
		// TODO: keep history per-symbol?
		this.activeEditorPane.editor.clearHistory()

		// new callers/callees are fetched ones
		this.calleesOfActive = callees.sort(compareByLength)
		this.callersOfActive = callers.sort(compareByLength)
		this.calleeIndex = 0
		this.callerIndex = 0
		this.updatePreviewPanes()
	}

	setActiveSymbolToNewSymbol(symbol: NewSymbolInContext) {
		this.activeEditorPane.symbol = symbol
		this.activeEditorPane.editor.setValue("")
		this.activeEditorPane.context.textContent = symbol.context.name
		// TODO: keep history per-symbol?
		this.activeEditorPane.editor.clearHistory()

		this.calleesOfActive = []
		this.callersOfActive = []
		this.calleeIndex = 0
		this.callerIndex = 0
		this.updatePreviewPanes()

		this.adapter.changeOwnedFile(symbol.context.uri)
	}

	/**
	 * Swaps to a symbol, finding its container if the given symbol
	 * should not be directly placed into the active editor pane.
	 */
	async swapToPossiblyNestedSymbol(rawSymbol: lsp.SymbolInformation | SymbolInfo, updateStack: boolean = true) {
		const symbolToNavigateTo = await this.getSymbolToNavigateTo(rawSymbol)
		if (symbolToNavigateTo) {
			this.swapToSymbol(symbolToNavigateTo, updateStack)
		}
	}

	/**
	 * Takes a symbol which may not be top level and returns
	 * the symbol that should be placed in the active editor
	 * pane when navigating to the given symbol.
	 *
	 * For example, given a class method, will return the class.
	 * Given a top-level function/class, will just return it.
	 */
	async getSymbolToNavigateTo(rawSymbol: lsp.SymbolInformation | SymbolInfo): Promise<SymbolInfo | undefined> {
		return (await this._getSymbolPreviewDetails(rawSymbol))?.symbol
	}

	/**
	 * Returns symbol to navigate to, preview string, and context
	 * of the given symbol.
	 */
	async _getSymbolPreviewDetails(rawSymbol: lsp.SymbolInformation | SymbolInfo):
		Promise<{ symbol: SymbolInfo; definitionString: string; context: Context } | undefined>
	{
		// we need the context to find the most updated copy of this symbol
		const context = await this.retrieveContextForSymbol(rawSymbol)

		// if we can't find the context, warn and return undefined
		if (!context) {
			console.warn("did not find context for symbol", rawSymbol)
			return undefined
		}

		// attempt to find the most updated copy of this symbol
		const topLevelSymbol = context.getTopLevelSymbol(rawSymbol.name)
		if (topLevelSymbol) {
			return { ...topLevelSymbol, context: context }
		}

		// If we didn't find the symbol at the top level, then
		// check if the wanted symbol is a child of a top-level symbol.
		const topLevelContainerSymbol = context.getTopLevelSymbolContaining(rawSymbol)
		if (topLevelContainerSymbol) {
			return {
				symbol: topLevelContainerSymbol[0],
				definitionString: topLevelContainerSymbol[1],
				context
			}
		} else {
			console.warn("did not find symbol to navigate to for symbol", rawSymbol)
			return undefined
		}
	}

	private symbolsEqual = (symbolA: SymbolInfo, symbolB: SymbolInfo): boolean => {
		// TODO: will this always hold?
		return symbolA.name === symbolB.name && symbolA.uri === symbolB.uri
			&& symbolA.range.start.line === symbolB.range.start.line
			&& symbolA.range.start.character === symbolB.range.start.character
			&& symbolA.range.end.line === symbolB.range.end.line
			&& symbolA.range.end.character === symbolB.range.end.character
	}

	updatePreviewPanes() {
		const assignSymbols = async (symbols, index, panes) => {
			const freePanes = panes.filter((pane) => !pane.isPinned)

			const pinnedSymbols = panes
				.filter((pane) => pane.isPinned)
				.map((pane) => pane.symbol)

			// the index to "start taking symbols from" is the paged offset
			// but can be bumped forward if any items before it are pinned
			let symbolIndexStartTakingFrom = index
			let symbolIndex = -1

			// strip leading tabs/spaces from definition string such that the minimum necessary indentation results
			const stripWhitespace = (origString: string): string => {
				// split string into lines
				const lines: string[] = origString.split("\n")
				// count min number of spaces/tabs
				let leastCount: number = -1
				for (const line of lines) {
					if (line.length === 0) {
						continue
					}
					let count: number = 0
					for (const char of line) {
						if (char === " " || char === "\t") {
							count += 1
						}
						else {
							break
						}
					}
					if (leastCount === -1 || count < leastCount) {
						leastCount = count
					}
				}
				// the string is all whitespace/empty
				if (leastCount === -1) {
					return origString
				}
				// construct new string with stripped whitespace
				return lines
					.map((line) => line.slice(leastCount))
					.join("\n")
			}

			const getNextSymbol = async (): Promise<[SymbolInfo | undefined, string | undefined, string]> => {
				symbolIndex += 1

				// if we don't have enough symbols to populate panes, return undefined
				if (!(symbolIndex < symbols.length)) {
					return [undefined, undefined, "(no symbol)"]
				}

				const symbolToPreview = await this._getSymbolPreviewDetails(symbols[symbolIndex])

				if (symbolToPreview) {
					// check if this candidate symbol is already in a pinned pane
					const symbolAlreadyPinned = pinnedSymbols
						.find((pinnedSymbol) => this.symbolsEqual(pinnedSymbol, symbolToPreview.symbol))

					// if the symbol is already pinned, call this function again
					// to get the next viable symbol after this one.
					if (symbolAlreadyPinned) {
						// if an already-pinned symbol occurs before the paged-to offset
						// then we need to bump the offset forward
						if (symbolIndex < symbolIndexStartTakingFrom) {
							symbolIndexStartTakingFrom += 1
						}

						return await getNextSymbol()
					}
				}

				// if we haven't yet reached the index that we've paged to,
				// then return the one after this (which could recur)
				if (symbolIndex < symbolIndexStartTakingFrom) {
					return await getNextSymbol()
				}

				if (!symbolToPreview) {
					// we should be previewing this symbol, but couldn't generate a preview
					console.warn("could not generate preview for symbol", symbols[symbolIndex])
					return [undefined, undefined, `(${symbols[symbolIndex].name}: no preview)`]
				}

				// we got a symbol that isn't already pinned, is past the offset, and is up-to-date
				return [
					symbolToPreview.symbol,
					stripWhitespace(symbolToPreview.definitionString),
					`${symbolToPreview.context.name}`,
				]
			}

			for (let i = 0; i < freePanes.length; i++) {
				const [newPaneSymbol, newPaneContent, newPaneContext] = await getNextSymbol()
				freePanes[i].symbol = newPaneSymbol
				freePanes[i].editor.setValue(newPaneContent ?? "")
				freePanes[i].context.textContent = newPaneContext
			}
		}

		assignSymbols(this.calleesOfActive, this.calleeIndex, this.calleePanes)
		assignSymbols(this.callersOfActive, this.callerIndex, this.callerPanes)
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
		if (this.navStack.length > 0 && this.navStack.length - 1 > this.curNavStackIndex) {
			this.curNavStackIndex += 1
			this.swapToSymbol(this.navStack[this.curNavStackIndex], false)
		} else {
			console.warn("cannot go forward End Of Stack ")
		}
	}

	async _initializeProject(text: string, filePath: string): Promise<Context> {
		this.activeEditorPane.symbol = null
		this.calleePanes.forEach((p) => p.symbol = null)
		this.callerPanes.forEach((p) => p.symbol = null)

		this.adapter.changeOwnedFile(null)
		this.navObject.reset()

		const url = pathToFileURL(path.resolve(filePath))
		// language server normalizes drive letter to lowercase, so follow
		if (process.platform === "win32" && (url.pathname ?? "")[2] == ":")
			url.pathname = "/" + url.pathname[1].toLowerCase() + url.pathname.slice(2)
		const uri = url.toString()

		const fileDir = path.resolve(path.dirname(filePath))
		this.currentProject = new Project()

		// update server settings (ctags)
		const baseSettings = this.lspClient.getBaseSettings().settings
		baseSettings.pyls.plugins.ctags.tagFiles.push({
			filePath: path.join(os.tmpdir(), "blink_tags"), // directory of tags file
			directory: fileDir // directory of project
		})
		this.lspClient.changeConfiguration({ settings: baseSettings })

		// analyze context once to obtain top level symbols
		const context = await this.AnalyzeForNewContext(uri, text, null)

		// analyze the context again after linearizing code - line numbers could change
		await this.ReanalyzeContext(context)

		// this is now the first context in our new project
		this.currentProject.contexts.push(context)

		return context
	}

	async activateNewProject(initialFilePath: string) {
		const context = await this._initializeProject("", initialFilePath)

		// set panes to empty
		this.setActiveSymbolToNewSymbol({ context })
		this.activeEditorPane.context.textContent = context.name
	}

	async activateProjectFromFile(filePath: string) {
		const contents = await promisify(fs.readFile)(filePath, { encoding: "utf8" })

		const context = await this._initializeProject(contents, filePath)

		const mainSymbol = context.findStartingSymbol()
		if (mainSymbol) {
			// swap to the main symbol in this context
			this.swapToSymbol(mainSymbol, true)
		} else {
			console.warn("no starting symbol detected")
		}
	}

	// MARK: LSP/NavObject Interface

	FindCallees(symbol: SymbolInfo): Thenable<lsp.SymbolInformation[]> {
		return this.adapter.navObject.findCallees(symbol)
	}

	async FindCallers(targetSymbol: SymbolInfo): Promise<SymbolInfo[]> {
		// TODO: make this language-agnostic
		// determine where the cursor should be before the name of the symbol
		const nameStartPos =
			(targetSymbol.kind === 5 /* SymbolKind.Class */) ? 6 // class Foo
			: (targetSymbol.kind === 13 /* SymbolKind.Variable */) ? 0 // foo = 5
			: (targetSymbol.kind === 14 /* SymbolKind.Constant */) ? 0 // foo = 5
			: 4 // def foo

		const locations = await this.adapter.navObject.findCallers({
			textDocument: { uri: targetSymbol.uri },
			position: { line: targetSymbol.range.start.line, character: nameStartPos },
		})

		// ensure we have loaded the context for each location
		const uris = new Set(locations.map((loc) => loc.uri))
		const retrieveContexts = Array.from(uris).map((uri) =>
			this.retrieveContextForUri(uri, null))

		await Promise.all(retrieveContexts)

		const callers: SymbolInfo[] = []
		let skippedSelf = false

		// for each reference recieved, find parent scope
		for (const loc of locations) {
			const symbol = this.navObject.bestSymbolForLocation(loc)

			// if no symbol was found, the reference is in the global scope, so ignore it
			if (symbol === null) {
				continue
			}

			// if the symbol's own definition is found, skip it the first time
			if (this.symbolsEqual(symbol, targetSymbol) && !skippedSelf) {
				skippedSelf = true
				continue
			}

			// if a symbol is already in callers, skip it every time
			let passed = true
			for (const sym2 of callers) {
				if (this.symbolsEqual(symbol, sym2)) {
					passed = false
					break
				}
			}
			if (!passed) {
				continue
			}

			callers.push(symbol)
		}

		return callers
	}

	/**
	 * Analyzes the document symbols in the given uri and updates the nav object.
	 *
	 * @param uri The uri of the file to analyze.
	 * @param contents The contents of the file. Only used when it has not been opened before.
	 * @returns The newly created context object for the given uri.
	 */
	async AnalyzeForNewContext(uri: string, contents: string, name: string | null): Promise<Context> {
		// if this document is already open, there is a context for it
		// so ReanalyzeContext should be used instead
		console.assert(!this.lspClient.isDocumentOpen(uri))

		this.lspClient.openDocument({
			languageId: "python",
			documentUri: uri,
			initialText: contents,
		})

		const symbols = await this.lspClient.getDocumentSymbol(uri)

		this.navObject.rebuildMaps(symbols ?? [], uri)

		const context = new Context(name ?? "Loading", uri)
		context.updateWithNavObject(contents, this.navObject)

		if (name === null) {
			context.name = context.findStartingSymbol()?.module ?? context.name
		}

		return context
	}

	/**
	 * Analyzes the document symbols in the given existing context and updates the nav object.
	 *
	 * @param context The context to analyze.
	 */
	async ReanalyzeContext(context: Context): Promise<void> {
		// if a context exists, its document must've been opened
		console.assert(this.lspClient.isDocumentOpen(context.uri))

		// update the language server with the latest change before analyzing
		let contents = context.getLinearizedCode()

		const isNewSymbol = (s: SymbolInfo | NewSymbolInContext): s is NewSymbolInContext =>
			(s as NewSymbolInContext).context !== undefined
		const isContextForNewSymbol = this.activeEditorPane.symbol
			&& isNewSymbol(this.activeEditorPane.symbol)
			&& this.activeEditorPane.symbol.context.uri === context.uri
		if (isContextForNewSymbol) {
			contents += "\n\n" + this.activeEditorPane.editor.getValue()
		}

		this.lspClient.sendChange(context.uri, { text: contents })

		const symbols = await this.lspClient.getDocumentSymbol(context.uri)

		this.navObject.rebuildMaps(symbols ?? [], context.uri)

		context.updateWithNavObject(contents, this.navObject)
	}

	// MARK: index.html Interface

	async openExistingProjectDialog() {
		const dialog = electron.remote.dialog

		const result = await dialog.showOpenDialog({
			properties : ["openFile"]
		})

		if (result.filePaths.length < 1) {
			return
		}

		const filePath = result.filePaths[0]

		await this.activateProjectFromFile(filePath)
	}

	async openCreateNewProjectDialog() {
		const result = await electron.remote.dialog.showSaveDialog({
			title: "Create initial file in project directory",
			buttonLabel: "Create"
		})

		if (result.canceled || result.filePath === undefined) { return }

		const initialFilePath = result.filePath
		await this.activateNewProject(initialFilePath)
	}


	/**
	 * loop through all contexts and save them
	 */
	async saveFile() {
		(document.querySelector("#save-button-indicator-group")! as HTMLDivElement).classList.remove("save-button-with-indicator");

		// fetch most up-to-date contexts
		const contexts = (await Promise.all(this.currentProject.contexts
			.map((context) => this.retrieveContextForUri(context.uri, null))))
			.filter((context): context is Context => context !== undefined)

		contexts.forEach((context) => {
			const isNewSymbol = (s: SymbolInfo | NewSymbolInContext): s is NewSymbolInContext =>
				(s as NewSymbolInContext).context !== undefined
			const isContextForNewSymbol = this.activeEditorPane.symbol
				&& isNewSymbol(this.activeEditorPane.symbol)
				&& this.activeEditorPane.symbol.context.uri === context.uri

			if (!(context.hasChanges || isContextForNewSymbol)) { return }
			const hasPath = context.uri !== null && (new NodeURL(context.uri).protocol !== "untitled")
			const contents = context.getLinearizedCode()

			if (hasPath) {
				return promisify(fs.writeFile)(new NodeURL(context.uri), contents, { encoding: "utf8" })
					.then(() => this.lspClient.saveDocument({ uri: context.uri }, contents))
			} else {
				const dialog = electron.remote.dialog

				return dialog.showSaveDialog({})
					.then((result) => {
						if (!result.filePath) {
							return Promise.reject()
						}
						return promisify(fs.writeFile)(result.filePath, contents, { encoding: "utf8" })
							.then(() => this.lspClient.saveDocument({ uri: context.uri }, contents))
					})
			}

		})

		;(document.querySelector("#save-button-indicator-group")! as HTMLDivElement)
			.classList.remove("save-button-with-indicator")
	}

	runProject() {
		const symbol = this.activeEditorPane.symbol
		if (!symbol) { return }

		const isNewSymbol = (s: SymbolInfo | NewSymbolInContext): s is NewSymbolInContext =>
			(s as NewSymbolInContext).context !== undefined
		if (isNewSymbol(symbol)) { return }

		const scriptPath = fileURLToPath(new NodeURL(symbol.uri))
		const ls = spawn(
			"python3",
			[scriptPath]
		)

		ls.stdout.on("data", (data) => {
			alert(data)
		})
	}

	togglePreviewPanePinned(pane: PaneObject) {
		pane.pinImg!.classList.toggle("pin-icon-pinned")
		pane.isPinned = !pane.isPinned
		this.updatePreviewPanes()
	}

	async toggleProjectStructure() {
		this.projectStructureToggled = !this.projectStructureToggled

		if (this.projectStructureToggled) {
			document.querySelector("#project-structure-bar")!.classList.add("col-3")
			document.querySelector("#project-structure-bar")!.classList.add("sidebar-true")
			document.querySelector("#project-structure-bar")!.classList.remove("sidebar-false")
			document.querySelector("#panes")!.classList.remove("col-11")
			document.querySelector("#panes")!.classList.add("col-8")
		} else {
			document.querySelector("#project-structure-bar")!.classList.remove("col-3")
			document.querySelector("#project-structure-bar")!.classList.add("sidebar-false")
			document.querySelector("#project-structure-bar")!.classList.remove("sidebar-true")
			document.querySelector("#panes")!.classList.add("col-11")
			document.querySelector("#panes")!.classList.remove("col-8")
		}

		;(window as any).$("#tree1").tree({
			autoOpen: true,
			dragAndDrop: false
		})

		// fetch most up-to-date contexts
		const contexts = (await Promise.all(this.currentProject.contexts
			.map((context) => this.retrieveContextForUri(context.uri, null))))
			.filter((context): context is Context => context !== undefined)

		const contextTrees: DisplaySymbolTree[] = contexts
			.map((context) => {
				return {
					name: context.name,
					id: context.uri,
					children: context.getDisplaySymbolTree()
				}
			})

		;(window as any).$("#tree1").tree("loadData", contextTrees)

		;(window as any).$("#tree1").on(
			"tree.click",
			(e) => {
				e.preventDefault()
				const symbol = (e.node as DisplaySymbolTree).rayBensSymbol
				if (symbol) {
					this.swapToPossiblyNestedSymbol(symbol)
				}
			}
		)
	}
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const editor = new Editor()
