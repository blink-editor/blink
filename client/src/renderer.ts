// This file is required by the index.html file and will
// be executed in the renderer process for that window.

import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { promisify } from "util"
import { URL as NodeURL, pathToFileURL, fileURLToPath } from "url"
import { spawn } from "child_process"
import debounce from "lodash.debounce"

import * as electron from "electron"
import CodeMirror from "codemirror"
import * as lsp from "vscode-languageserver-protocol"

import { Context, DisplaySymbolTree, Document as ContextDocument } from "./Context"
import { Project, ContextSymbolReference } from "./Project"
import { CodeMirrorAdapter } from "./codemirror-adapter"
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
	symbol: ContextSymbolReference | null
	isPinned: boolean
	pinImg: Element | null
}

interface NewSymbolInContext {
	context: Context
	initialDocument: ContextDocument
}

interface ActiveEditorPane {
	editor: CodeMirror.Editor
	context: Element
	symbol: ContextSymbolReference | NewSymbolInContext | null
}

const isNewSymbol = (s: ContextSymbolReference | NewSymbolInContext): s is NewSymbolInContext =>
	(s as NewSymbolInContext).initialDocument !== undefined

class Editor {
	// program state
	lspClient: client.LspClient
	adapter: CodeMirrorAdapter

	// editor/project state
	calleePanes: [PaneObject, PaneObject, PaneObject]
	callerPanes: [PaneObject, PaneObject, PaneObject]

	navStack: ContextSymbolReference[] = []
	curNavStackIndex = 0

	activeEditorPane: ActiveEditorPane

	calleesOfActive: ContextSymbolReference[] = []
	callersOfActive: ContextSymbolReference[] = []
	calleeIndex = 0
	callerIndex = 0

	projectStructureToggled: boolean = false

	currentProject: Project = new Project(null, "Untitled")

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
				lineWrapping: wrapping,
				indentUnit: 4,
				indentWithTabs: false,
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
			this.lspClient = new client.LspClientImpl(connection, logger)
			this.lspClient.initialize()

			// The adapter is what allows the editor to provide UI elements
			this.adapter = new CodeMirrorAdapter(this.lspClient, {
				// UI-related options go here, allowing you to control the automatic features of the LSP, i.e.
				suggestOnTriggerCharacters: false
			}, this.activeEditorPane.editor)

			this.adapter.onChange = this.onActiveEditorChanged.bind(this)
			this.adapter.onGoToLocation = this.goToLocation.bind(this)
			this.adapter.getLineOffset = this.getActiveEditorLineOffset.bind(this)
			this.adapter.openRenameSymbol = this.openRenameSymbol.bind(this)

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

		const context = activeSymbol.context

		if (isNewSymbol(activeSymbol)) {
			// uses file instance from time when "new symbol" mode was entered.
			// relies on the fact that once entering new symbol mode, you can't alter other symbols.
			const startingFile = activeSymbol.initialDocument.file
			const lspCode = startingFile === "" ? text : (startingFile + "\n\n" + text)

			// Context doesn't have a concept of a "new symbol" mode
			// so just replace the file and let it work itself out
			context.replaceEntireFile(null, lspCode)

			// send the change to the server so it's up to date
			this.lspClient.sendChange(context.uri, { text: lspCode })
		} else {
			// update our knowledge of the active symbol
			context.updateChunkDefinition(activeSymbol, text)

			// send the change to the server so it's up to date
			const lspCode = context.currentDocument.file
			this.lspClient.sendChange(activeSymbol.context.uri, { text: lspCode })
		}

		// show save indicator
		;(document.querySelector("#save-button-indicator-group")! as HTMLDivElement)
			.classList.add("save-button-with-indicator")

		// debounce performing reanalysis because they might still be typing
		this.debouncedReanalyzeAfterTyping(context)
	}

	async _reanalyze(context: Context) {
		// if a context exists, its document must've been opened
		console.assert(this.lspClient.isDocumentOpen(context.uri))

		// update the language server with the latest change before analyzing
		const document = context.currentDocument
		this.lspClient.sendChange(context.uri, { text: document.file })

		const symbols = await this._getDocumentSymbol(context.uri)

		if (document.version !== context.currentDocument.version) {
			console.warn("skipping update because document is out of date")
			return
		}

		context.updateWithDocumentSymbols(document, symbols)

		// if the active symbol's document changes, attempt to find it in the new version
		// if the user is in "new symbol" mode, let them keep editing without upgrading
		// TODO: do we want to upgrade them when a symbol is detected in what they're editing?
		if (this.activeEditorPane.symbol
				&& !isNewSymbol(this.activeEditorPane.symbol)
				&& this.activeEditorPane.symbol.context.uri === context.uri) {
			const upgradedSymbol = context.upgradeSymbolReference(this.activeEditorPane.symbol)
			const newActiveSymbol = upgradedSymbol ?? context.findStartingSymbol(context.currentDocument)
			if (newActiveSymbol) {
				this.swapToSymbol({ ...newActiveSymbol, context }, false)
			}
		}
	}

	debouncedReanalyzeAfterTyping =
		debounce(this._reanalyze, 300)

	/**
	 * Returns the line number of the beginning of the currently active symbol
	 * within the file string returned by `linearizeContextCode`.
	 *
	 * Called by the codemirror adapter to translate visual line numbers
	 * to actual language server protocol line numbers.
	 */
	getActiveEditorLineOffset(): number {
		if (!this.activeEditorPane.symbol) {
			return 0
		}

		if (isNewSymbol(this.activeEditorPane.symbol)) {
			// TODO: more efficient way of doing this?
			// TODO: worry about other line endings
			return this.activeEditorPane.symbol.initialDocument.file.split("\n").length - 1
		}

		return this.activeEditorPane.symbol.context.chunkForSymbol(this.activeEditorPane.symbol)!.lineOffset
	}

	async goToLocation(location: lsp.Location) {
		const context = await this.retrieveContextForUri(location.uri)
		if (!context) {
			console.warn("could not retrieve context for location", location)
			return
		}
		// TODO: may not be right document?
		const locatedSymbol = context.bestSymbolForLocation(context.currentDocument, location.range)
		if (locatedSymbol) {
			this.swapToSymbol({ ...locatedSymbol, context })
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
		(document.querySelector("#find-name-modal-container") as HTMLDivElement).style.display = "flex";
		(document.querySelector("#find-name-input") as HTMLInputElement).focus()
	}

	closeJumpToSymByName(event: MouseEvent) {
		// check that user clicked on #modal-container
		if ((event.target as HTMLElement).id === "find-name-modal-container")
			this.closeJumpToSymByNameUnconditional()
	}

	// closes prompt allowing user to fuzzy search for symbol and jump to it
	closeJumpToSymByNameUnconditional() {
		// close window
		(document.querySelector("#find-name-modal-container") as HTMLDivElement).style.display = "none"
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
					el.addEventListener("click", async () => {
						// swap to clicked symbol and close window
						this.closeJumpToSymByNameUnconditional()
						await this.goToLocation(result.location)
					})

					list.appendChild(el)
				})
			})
		})
	}

	// opens prompt allowing user to rename a symbol
	openRenameSymbol(atLocation: lsp.TextDocumentPositionParams) {
		(document.querySelector("#rename-modal-container") as HTMLDivElement).style.display = "flex";
		(document.querySelector("#rename-input") as HTMLInputElement).focus()

		const nameInput = (document.querySelector("#rename-input") as HTMLInputElement)

		const listener = (event) => {
			// if enter is pressed, rename with given name
			if (event.keyCode === 13) {
				nameInput.removeEventListener("keydown", listener)

				this.renameSymbol({ ...atLocation, newName: nameInput.value })
				this.closeRenameSymbolUnconditional()
			}
		}

		nameInput.addEventListener("keydown", listener)
	}

	closeRenameSymbol(event: MouseEvent) {
		// check that user clicked on #rename-modal-container
		if ((event.target as HTMLElement).id === "rename-modal-container")
			this.closeRenameSymbolUnconditional()
	}

	// closes prompt allowing user to rename symbol
	closeRenameSymbolUnconditional() {
		// close window
		(document.querySelector("#rename-modal-container") as HTMLDivElement).style.display = "none"
		// clear input
		;(document.querySelector("#rename-input") as HTMLInputElement).value = ""
	}

	async renameSymbol(params: lsp.RenameParams) {
		if (params.newName.trim() === "") { return }

		// require the user to save before renaming - rope reads from disk
		await this.saveFile()

		const contextDocumentsBeforeRename: Map<string, ContextDocument> =
			this.currentProject.contexts.reduce((acc: Map<string, ContextDocument>, cur: Context) => {
				acc.set(cur.uri, cur.currentDocument)
				return acc
			}, new Map())

		// make lsp call
		const result = await this.lspClient.renameSymbol(params)
		if (result === null) { return }

		// use documentChanges
		if (result.documentChanges) {
			for (const change of result.documentChanges) {
				const docEdit = (change as lsp.TextDocumentEdit)
				const contents = docEdit.edits[0].newText // TODO: check range

				const context = this.currentProject.contextForUri(docEdit.textDocument.uri)
				if (!context) {
					// TODO: handle this better (create context?)
					console.warn("rename is trying to modify a file that isn't open yet; skipping", docEdit.textDocument)
					return
				}

				const previousDocument = contextDocumentsBeforeRename.get(context.uri)!
				context.replaceEntireFile(previousDocument, contents)

				this._reanalyze(context)
			}
		}
		// use changes
		else if (result.changes) {
			// TODO: support changes
			throw new Error("Not Supported: WorkspaceEdit response from Rename request did not contain documentChanges.")
		}
	}

	async retrieveContextForUri(uri: string): Promise<Context | undefined> {
		// obtain the definition string of the new symbol
		const project = this.currentProject
		let context = project.contextForUri(uri)

		// if the context wasn't found - meaning we haven't loaded this file
		// then go ahead and load up the file
		if (!context) {
			const url = new NodeURL(uri)
			console.assert(url.protocol == "file:")

			try {
				const contents = await promisify(fs.readFile)(url, { encoding: "utf8" })

				const newContext = await this.AnalyzeForNewContext(uri, contents)
				project.contexts.push(newContext)
				context = newContext
			} catch (error) {
				console.warn("could not build context for uri", uri, error)
				return undefined
			}
		} else {
			// if this assertion fails we might be calling this too early
			console.assert(!context.hasChangedSinceUpdate)
		}

		return context
	}

	async swapToSymbol(rawSymbolRef: ContextSymbolReference, updateStack: boolean = true) {
		let symbolRef: ContextSymbolReference = rawSymbolRef

		const context = symbolRef.context
		if (symbolRef.documentHandle.version !== context.currentDocument.version) {
			const v1 = symbolRef.documentHandle.version
			const v2 = context.currentDocument.version
			console.warn(`document version mismatch (swapToSymbol): ${v1} vs ${v2}`, symbolRef)

			const upgraded = context.upgradeSymbolReference(symbolRef)
			if (upgraded) {
				symbolRef = { ...upgraded, context }

				// replace old symbols with the upgraded one in nav stack
				// TODO: what about pinned panes? (slightly less important: project structure)
				// callers and callees that are not pinned will be refreshed below
				this.navStack = this.navStack
					.map((item) => {
						if (item.context.uri === symbolRef.context.uri
								&& item.path.toString() === symbolRef.path.toString()) { // TODO: better array eq
							return symbolRef
						}
						return item
					})
			} else {
				console.error("could not upgrade symbol in swapToSymbol", symbolRef, context)
				return
			}
		}

		const contents = context.chunkForSymbol(symbolRef)!.contents

		if (updateStack) {
			// update the navStack
			this.navStack.push(symbolRef)
			this.curNavStackIndex = this.navStack.length - 1
		}

		// fetch new callees and callers
		const calleesAsync = this.FindCallees(symbolRef)
		const callersAsync = this.FindCallers(symbolRef)

		// don't update any panes / props until done
		const [callees, callers] = await Promise.all([calleesAsync, callersAsync])

		// populate active editor pane
		this.activeEditorPane.symbol = symbolRef
		const selections = this.activeEditorPane.editor.listSelections()
		this.activeEditorPane.editor.setValue(contents)

		// restore the cursor position since setValue moves it to beginning
		// especially necessary for when the active symbol gets refreshed
		// TODO: keep cursor position per-symbol?
		this.activeEditorPane.editor.setSelections(selections, undefined, { scroll: false })

		// clear history so that you can't undo into the previous symbol
		// TODO:
		// - fix losing history when just upgrading the same symbol
		// - maybe don't even setValue if it's the same symbol
		// - investigate using CodeMirror documents per-symbol (ray)
		// TODO: keep history per-symbol?
		this.activeEditorPane.editor.clearHistory()
		this.activeEditorPane.context.textContent = context.moduleName ?? null

		// change which file we're tracking as "currently editing"
		// TODO: close the old one?
		this.adapter.changeOwnedFile(context.uri)

		// update preview panes
		// new callers/callees are fetched ones
		this.calleesOfActive = callees
		this.callersOfActive = callers
		this.calleeIndex = 0
		this.callerIndex = 0
		this.updatePreviewPanes()
	}

	setActiveSymbolToNewSymbol(symbol: NewSymbolInContext) {
		this.activeEditorPane.symbol = symbol
		this.activeEditorPane.editor.setValue("")
		this.activeEditorPane.context.textContent = symbol.context.moduleName ?? null
		// TODO: keep history per-symbol?
		this.activeEditorPane.editor.clearHistory()

		// change which file we're tracking as "currently editing"
		this.adapter.changeOwnedFile(symbol.context.uri)

		this.calleesOfActive = []
		this.callersOfActive = []
		this.calleeIndex = 0
		this.callerIndex = 0
		this.updatePreviewPanes()
	}

	updatePreviewPanes() {
		const assignSymbols = (symbols: ContextSymbolReference[], index: number, panes: PaneObject[]) => {
			const freePanes = panes.filter((pane) => !pane.isPinned)

			const pinnedSymbols = panes
				.filter((pane) => pane.isPinned)
				.map((pane) => pane.symbol)
				.filter((pinnedSymbol): pinnedSymbol is ContextSymbolReference => pinnedSymbol !== null)

			// the index to "start taking symbols from" is the paged offset
			// but can be bumped forward if any items before it are pinned
			let symbolIndexStartTakingFrom = index
			let symbolIndex = -1

			const getNextSymbol = (): [ContextSymbolReference | undefined, string | undefined, string] => {
				symbolIndex += 1

				// if we don't have enough symbols to populate panes, return undefined
				if (!(symbolIndex < symbols.length)) {
					return [undefined, undefined, "(no symbol)"]
				}

				const rawSymbol = symbols[symbolIndex]

				// check if this candidate symbol is already in a pinned pane
				// TODO: may be a document version mismatch if pinned
				const symbolAlreadyPinned = pinnedSymbols
					.find((pinnedSymbol) => this._symbolsEqual(pinnedSymbol, rawSymbol))

				// if the symbol is already pinned, call this function again
				// to get the next viable symbol after this one.
				if (symbolAlreadyPinned) {
					// if an already-pinned symbol occurs before the paged-to offset
					// then we need to bump the offset forward
					if (symbolIndex < symbolIndexStartTakingFrom) {
						symbolIndexStartTakingFrom += 1
					}

					return getNextSymbol()
				}

				// if we haven't yet reached the index that we've paged to,
				// then return the one after this (which could recur)
				if (symbolIndex < symbolIndexStartTakingFrom) {
					return getNextSymbol()
				}

				// attempt to extract the preview for this symbol
				const preview = rawSymbol.context.previewForSymbol(rawSymbol)

				// we got a symbol that isn't already pinned, is past the offset, and is up-to-date
				return [
					{ ...preview[0], context: rawSymbol.context },
					preview[1],
					`${rawSymbol.context.moduleName ?? "Loading"}`,
				]
			}

			for (let i = 0; i < freePanes.length; i++) {
				const [newPaneSymbol, newPaneContent, newPaneContext] = getNextSymbol()
				freePanes[i].symbol = newPaneSymbol ?? null
				freePanes[i].context.textContent = newPaneContext
				freePanes[i].editor.setValue(newPaneContent ?? "")
				// reformat indentation to remove leading whitespace from lines
				freePanes[i].editor.execCommand("selectAll")
				freePanes[i].editor.execCommand("indentAuto")
				freePanes[i].editor.setCursor(0, 0)
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
		this.currentProject.contexts.forEach((context) => {
			this.lspClient.closeDocument(context.uri)
		})

		const url = pathToFileURL(path.resolve(filePath))
		// language server normalizes drive letter to lowercase, so follow
		if (process.platform === "win32" && (url.pathname ?? "")[2] == ":")
			url.pathname = "/" + url.pathname[1].toLowerCase() + url.pathname.slice(2)
		const fileUri = url.toString()

		// change project / workspace folder
		const workspacePath = path.resolve(path.dirname(filePath))
		const workspaceUri = pathToFileURL(workspacePath).toString()
		this.currentProject = new Project(workspaceUri, path.basename(workspacePath))
		this.lspClient.changeWorkspaceFolder({
			uri: this.currentProject.uri!,
			name: this.currentProject.name,
		})

		// update server settings (ctags)
		const baseSettings = this.lspClient.getBaseSettings().settings
		baseSettings.pyls.plugins.ctags.tagFiles.push({
			filePath: path.join(os.tmpdir(), "blink_tags"), // directory of tags file
			directory: workspacePath // directory of project
		})
		this.lspClient.changeConfiguration({ settings: baseSettings })

		// analyze context once to obtain top level symbols
		const context = await this.AnalyzeForNewContext(fileUri, text)

		// this is now the first context in our new project
		this.currentProject.contexts.push(context)

		return context
	}

	async activateNewProject(initialFilePath: string) {
		const context = await this._initializeProject("", initialFilePath)

		// set panes to empty
		this.setActiveSymbolToNewSymbol({
			context,
			initialDocument: context.currentDocument,
		})
	}

	async activateProjectFromFile(filePath: string) {
		const contents = await promisify(fs.readFile)(filePath, { encoding: "utf8" })

		const context = await this._initializeProject(contents, filePath)

		const document = context.currentDocument
		const mainSymbol = context.findStartingSymbol(document)

		if (mainSymbol) {
			// swap to the main symbol in this context
			this.swapToSymbol({ ...mainSymbol, context }, true)
		} else {
			console.warn("no starting symbol detected")
		}
	}

	// MARK: LSP/NavObject Interface

	_symbolsEqual(symbolA: ContextSymbolReference, symbolB: ContextSymbolReference): boolean {
		if (symbolA.context.uri === symbolB.context.uri) {
			// for the comparison to be well-defined, these symbols must come from the same document
			console.assert(symbolA.documentHandle.version === symbolB.documentHandle.version)
		}

		return symbolA.context.uri === symbolB.context.uri
			&& symbolA.path.toString() === symbolB.path.toString() // TODO: better array eq
	}

	/*
   * Returns a string that uniquely identifies this symbol
   */
	_symbolHash(symbol: ContextSymbolReference): string {
		return JSON.stringify([symbol.context.uri, symbol.documentHandle.version, symbol.path.toString()])
	}

	/*
	 * Finds all the symbols referenced within the given symbol scope.
	 * @param symbol  The symbol to find calls in.
	 * @returns    An array of SymbolInfo objects with ranges that enclose the definitions of functions being called in the given function.
	 */
	async FindCallees(symbolRef: ContextSymbolReference): Promise<ContextSymbolReference[]> {
		const context = symbolRef.context
		console.assert(!context.hasChangedSinceUpdate)

		const parentSymbol = context.resolveSymbolReference(symbolRef)
		const usedSymbols = symbolRef.documentHandle.data!.usedSymbols

		const usedSymbolInfos = usedSymbols
			.filter((symbol) => {
				// since we're using the whole-document usedDocumentSymbols
				// we need to filter out usages not within the function we care about
				const usageRange: lsp.Range = symbol.rayBensUsageRange
				if (!(usageRange.start.line >= parentSymbol.range.start.line
						&& usageRange.end.line <= parentSymbol.range.end.line)) {
					return false
				}

				// we also want to filter out things defined within the parent symbol scope
				if (symbol.location.uri == context.uri
						&& symbol.location.range.start.line >= parentSymbol.range.start.line
						&& symbol.location.range.end.line < parentSymbol.range.end.line) {
					return false
				}

				return true
			})

		// TODO: fix performance - lazy vs eager, loading builtins.pyc file
		// https://jedi.readthedocs.io/en/latest/_modules/jedi/api/classes.html#BaseDefinition.in_builtin_module
		const uris: Set<string> = new Set(usedSymbolInfos.map((s) => s.location.uri))

		const loadContexts: Promise<[string, Context | undefined][]>
			= Promise.all(Array.from(uris)
				.map((uri) => Promise.all([
					Promise.resolve(uri),
					this.retrieveContextForUri(uri)
				]) as Promise<[string, Context | undefined]>))

		const contextForUri: Map<string, Context> =
			(await loadContexts)
			.reduce((acc, [uri, context]) => {
				if (context) { acc.set(uri, context) }
				return acc
			}, new Map<string, Context>())

		const callees = usedSymbolInfos
			.map((usedSymbol: client.RayBensSymbolInformation): ContextSymbolReference | undefined => {
				const candidateContext = contextForUri.get(usedSymbol.location.uri)
				if (!candidateContext) { return undefined }

				if (candidateContext.uri === context.uri) {
					console.assert(candidateContext.currentDocument.version === symbolRef.documentHandle.version)
				}

				const candidate = candidateContext.bestSymbolForLocation(candidateContext.currentDocument, usedSymbol.location.range)

				// if no symbol was found, the reference is in the global scope, so ignore it
				if (candidate === undefined) {
					return undefined
				}

				return { ...candidate, context: candidateContext }
			})
			.filter((e): e is ContextSymbolReference => e !== undefined)

		return callees.sort(this._sortPaneSymbols.bind(this))
	}

	/*
	 * Finds the callers of a function whose name is at the position given. Should be called on navigate, return, save.
	 *
	 * @param symPos  A position object representing the position of the name of the function to find callers of.
	 * @returns       An array of DocumentSymbol objects with ranges that enclose the definitions of calling functions.
	 */
	async FindCallers(symbolRef: ContextSymbolReference): Promise<ContextSymbolReference[]> {
		const context = symbolRef.context
		console.assert(!context.hasChangedSinceUpdate)

		const symbol = context.resolveSymbolReference(symbolRef)

		// TODO: make this language-agnostic
		// determine where the cursor should be before the name of the symbol
		const nameStartPos =
			(symbol.kind === lsp.SymbolKind.Class) ? 6 // class Foo
			: (symbol.kind === lsp.SymbolKind.Variable) ? 0 // foo = 5
			: (symbol.kind === lsp.SymbolKind.Constant) ? 0 // foo = 5
			: (symbol.kind === lsp.SymbolKind.Module) ? 7 // import foo
			: 4 // def foo

		const locations = await this.lspClient.getReferencesWithRequest({
			textDocument: { uri: context.uri },
			position: { line: symbol.range.start.line, character: nameStartPos },
			context: {
				includeDeclaration: false,
			},
		}) ?? []

		let foundCallerDetails = new Set<string>()
		let skippedSelf = false

		const symbolForLocation = async (location: lsp.Location): Promise<ContextSymbolReference | null> => {
			const candidateContext = (await this.retrieveContextForUri(location.uri))!
			if (candidateContext.uri === context.uri) {
				console.assert(candidateContext.currentDocument.version === symbolRef.documentHandle.version)
			}

			const candidate = candidateContext.bestSymbolForLocation(candidateContext.currentDocument, location.range)

			// if no symbol was found, the reference is in the global scope, so ignore it
			if (candidate === undefined) {
				return null
			}

			const candidateRef = { ...candidate, context: candidateContext }

			// if the symbol's own definition is found, skip it
			// only skip one time (to support recursion)
			if (this._symbolsEqual(candidateRef, symbolRef) && !skippedSelf) {
				skippedSelf = true
				return null
			}

			// if this symbol is already in callers, skip it
			const callerDetails = this._symbolHash(candidateRef)
			if (foundCallerDetails.has(callerDetails)) {
				return null
			} else {
				foundCallerDetails.add(callerDetails)
			}

			return candidateRef
		}

		// TODO:
		// - not do this in parallel to match callees?
		// - seems like there would be problems if callers/callees in parallel too?
		// TODO: fix performance - lazy vs eager, loading builtins.pyc file
		const callers = (await Promise.all(locations.map(symbolForLocation)))
			.filter((e): e is ContextSymbolReference => e !== null)

		return callers.sort(this._sortPaneSymbols.bind(this))
	}

	/**
	 * Compares two symbols by decreasing length in terms of number of lines the definition takes.
	 */
	_sortPaneSymbols(a: ContextSymbolReference, b: ContextSymbolReference): number {
		const aPreviewSymbol = a.context.resolveSymbolReference(a.context.previewForSymbol(a)[0])
		const bPreviewSymbol = b.context.resolveSymbolReference(b.context.previewForSymbol(b)[0])

		const aLength = aPreviewSymbol.range.end.line - aPreviewSymbol.range.start.line + 1
		const bLength = bPreviewSymbol.range.end.line - bPreviewSymbol.range.start.line + 1

		return aLength > bLength ? -1
			: bLength > aLength ? 1
			: 0
	}

	async _getDocumentSymbol(uri: string): Promise<[lsp.DocumentSymbol[], client.RayBensSymbolInformation[]]> {
		// Used to check that the given parameter is of type documentSymbol[]
		const isDocumentSymbolArray = (symbols: lsp.DocumentSymbol[] | lsp.SymbolInformation[]):
			symbols is lsp.DocumentSymbol[] =>
		{
			return (symbols as lsp.DocumentSymbol[]).length === 0
				|| (symbols as lsp.DocumentSymbol[])[0].children !== undefined
		}

		// TODO: we may also want to use an existing "call graph" API
		// https://github.com/microsoft/language-server-protocol/issues/468
		let values = await Promise.all([
			this.lspClient.getDocumentSymbol(uri),
			this.lspClient.getRayBensUsedDocumentSymbols(uri),
		])
		const docSymbols = (values[0] ?? []) as lsp.DocumentSymbol[] | lsp.SymbolInformation[]
		const usedSymbols = values[1] as client.RayBensSymbolInformation[]

		if (!isDocumentSymbolArray(docSymbols)) {
			console.error("did not receive hierarchical document symbols from server")
			return [[], usedSymbols]
		}

		return [docSymbols, usedSymbols]
	}

	/**
	 * Analyzes the document symbols in the given uri and updates the nav object.
	 *
	 * @param uri The uri of the file to analyze.
	 * @param contents The contents of the file. Only used when it has not been opened before.
	 * @returns The newly created context object for the given uri.
	 */
	async AnalyzeForNewContext(uri: string, contents: string): Promise<Context> {
		// if this document is already open, there is a context for it
		console.assert(!this.lspClient.isDocumentOpen(uri))

		this.lspClient.openDocument({
			languageId: "python",
			documentUri: uri,
			initialText: contents,
		})

		const symbols = await this._getDocumentSymbol(uri)

		const context = new Context(uri, contents)
		const document = context.currentDocument
		context.updateWithDocumentSymbols(document, symbols)

		return context
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

		await Promise.all(this.currentProject.contexts.map(async (context) => {
			const document = context.currentDocument
			if (document.saved) { return }

			const hasPath = context.uri !== null && (new NodeURL(context.uri).protocol !== "untitled")
			const contents = document.file

			if (hasPath) {
				await promisify(fs.writeFile)(new NodeURL(context.uri), contents, { encoding: "utf8" })
			} else {
				const dialog = electron.remote.dialog
				const result = await dialog.showSaveDialog({})

				if (!result.filePath) {
					return
				}

				await promisify(fs.writeFile)(result.filePath, contents, { encoding: "utf8" })
				// TODO: update context uri to known path
				// context.uri = result.filePath
			}

			// TODO: can this conflict if an edit is made concurrently?
			await this.lspClient.saveDocument({ uri: context.uri }, contents)

			document.saved = true
		}))

		;(document.querySelector("#save-button-indicator-group")! as HTMLDivElement)
			.classList.remove("save-button-with-indicator")
	}

	runProject() {
		const symbol = this.activeEditorPane.symbol
		if (!symbol) { return }

		const scriptUri = symbol.context.uri
		const scriptPath = fileURLToPath(new NodeURL(scriptUri))

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

		const contextTrees: DisplaySymbolTree[] = this.currentProject.contexts
			.map((context) => {
				return {
					name: context.moduleName ?? "Loading",
					id: context.uri,
					children: context.getDisplaySymbolTree()
				}
			})

		;(window as any).$("#tree1").tree("loadData", contextTrees)

		;(window as any).$("#tree1").on(
			"tree.click",
			(e) => {
				e.preventDefault()
				const symbolData = (e.node as DisplaySymbolTree).rayBensSymbol
				if (symbolData) {
					this.swapToSymbol(symbolData)
				}
			}
		)
	}
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const editor = new Editor()
