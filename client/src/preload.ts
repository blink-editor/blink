// All of the Node.js APIs are available in the preload process.
// It has the same sandbox as a Chrome extension.
import { promisify } from "util"
import * as fs from "fs"
import * as path from "path"
import * as client from "./langserver-client"
import * as lsp from "vscode-languageserver-protocol"
import * as events from "events"
import { ipcRenderer } from "electron"
import CodeMirror from "codemirror"
import { CodeMirrorAdapter } from "./codemirror-adapter"
import { NavObject, SymbolInfo } from "./nav-object"
// css imported in html for now
// import "./codemirror-lsp.css"
import "codemirror/mode/python/python"
// import "codemirror/lib/codemirror.css"
// import "codemirror/theme/monokai.css"
import "codemirror/addon/hint/show-hint"
// import "codemirror/addon/hint/show-hint.css"

class GlobalEventsImpl extends events.EventEmitter implements GlobalEvents {}
let lspClient: client.LspClient
let adapter: CodeMirrorAdapter
let navObject: NavObject

const globals = {
	CodeMirror: CodeMirror
} as Globals

window["globals"] = globals

globals.events = new GlobalEventsImpl()

ipcRenderer.once("server-connected", () => {
	globals.events.emit("server-connected")
	globals.serverConnected = true
})

/**
 * Will nag the main process to start the server for us if
 * the server isn't currently up for some reason.
 */
globals.TryStartingServer = function() {
	ipcRenderer.send("try-starting-server")
}

globals.ConfigureEditorAdapter = function(params: ConfigureEditorAdapterParams) {
	const logger = new client.ConsoleLogger()

	client.createTcpRpcConnection("localhost", 2087, (connection) => {
		lspClient = new client.LspClientImpl(connection, undefined, logger)
		lspClient.initialize()

		navObject = new NavObject(lspClient)

		// The adapter is what allows the editor to provide UI elements
		adapter = new CodeMirrorAdapter(lspClient, navObject, {
			// UI-related options go here, allowing you to control the automatic features of the LSP, i.e.
			suggestOnTriggerCharacters: false
		}, params.editor)

		adapter.onChange = params.onChange
		adapter.onShouldSwap = params.onShouldSwap
		adapter.getLineOffset = params.getLineOffset

		lspClient.once("initialized", () => {
			setTimeout(() => {
				globals.events.emit("client-initialized")
				globals.clientInitialized = true
			}, 50)
		})
	}, logger)
}

globals.FindCallees = function(symbol: SymbolInfo): Thenable<lsp.SymbolInformation[]> {
	if (!adapter) { return Promise.resolve([]) }
	return adapter.navObject.findCallees(symbol)
}

globals.FindCallers = function(pos: lsp.TextDocumentPositionParams): Thenable<SymbolInfo[]> {
	if (!adapter) { return Promise.resolve([]) }
	return adapter.navObject.findCallers(pos)
}

globals.ChangeOwnedFile = function(uri: string, contents: string): void {
	lspClient.openDocument({
		languageId: "python",
		documentUri: uri,
		initialText: contents,
	})
	// TODO: close old one? wait for open before changing adapter?
	adapter.changeOwnedFile(uri, contents)
}

/**
 * Analyzes the document symbols in the given uri and updates the nav object.
 *
 * @param uri The uri of the file to analyze.
 * @param contents The contents of the file. Only used when it has not been opened before.
 */
globals.AnalyzeUri = function(uri: string, contents: string): Thenable<NavObject> {
	if (!lspClient.isDocumentOpen(uri)) {
		lspClient.openDocument({
			languageId: "python",
			documentUri: uri,
			initialText: contents,
		})
	}
	return lspClient.getDocumentSymbol(uri)
		.then((symbols) => {
			navObject.rebuildMaps(symbols ?? [], uri)
			return navObject
		})
}

// 2
;(window as any).openFileDialogForEditor = function(): Thenable<[string, string] | undefined> {
	const dialog = require("electron").remote.dialog

	return dialog.showOpenDialog({
		properties : ["openFile"]
	})
		.then((result) => {
			if (result.filePaths.length < 1) {
				return Promise.resolve(undefined)
			}
			const dirPromise = Promise.resolve(result.filePaths[0])
			const fileTextPromise = promisify(fs.readFile)(result.filePaths[0], { encoding: "utf8" })
			return Promise.all([dirPromise, fileTextPromise])
		})
}

;(window as any).openSaveDialogForEditor = function(fileText: string): Thenable<string | undefined> {
	const dialog = require("electron").remote.dialog

	return dialog.showSaveDialog({})
		.then((result) => {
			if (!result.filePath) {
				return Promise.resolve(undefined)
			}

			return promisify(fs.writeFile)(result.filePath, fileText, { encoding: "utf8" })
				.then(() => result.filePath)
		})
}

;(window as any).saveWithoutDialog = function(fileText: string, filePath: string): Thenable<string | undefined> {
	return promisify(fs.writeFile)(filePath, fileText, {encoding: "utf8"})
		.then(() => "success")
}
