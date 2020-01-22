// All of the Node.js APIs are available in the preload process.
// It has the same sandbox as a Chrome extension.
import { promisify } from "util"
import * as fs from "fs"
import * as client from "./langserver-client"
import * as lsp from "vscode-languageserver-protocol"
import * as events from "events"
import { ipcRenderer } from "electron"
import CodeMirror from "codemirror"
import { CodeMirrorAdapter } from "./codemirror-adapter"
import { SymbolInfo } from "./nav-object"
// css imported in html for now
// import "./codemirror-lsp.css"
import "codemirror/mode/python/python"
// import "codemirror/lib/codemirror.css"
// import "codemirror/theme/monokai.css"
import "codemirror/addon/hint/show-hint"
// import "codemirror/addon/hint/show-hint.css"

class GlobalEventsImpl extends events.EventEmitter implements GlobalEvents {}
const app = require('electron').remote.app
let lspClient: client.LspClient
let adapter: CodeMirrorAdapter

const globals = {
	CodeMirror: CodeMirror,
	app: app
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
		const firstDocumentUri = "untitled:///file"

		const documentInfo: client.DocumentInfo = {
			languageId: "python",
			documentUri: firstDocumentUri,
			initialText: params.initialFileText
		}

		lspClient = new client.LspClientImpl(connection, undefined, logger)
		lspClient.initialize()

		lspClient.openDocument(documentInfo)

		// The adapter is what allows the editor to provide UI elements
		adapter = new CodeMirrorAdapter(lspClient, {
			// UI-related options go here, allowing you to control the automatic features of the LSP, i.e.
			suggestOnTriggerCharacters: false
		}, params.editor, firstDocumentUri)

		adapter.onChange = params.onChange
		adapter.onShouldSwap = params.onShouldSwap
		adapter.getLineOffset = params.getLineOffset

		// TODO: ensure this is always called after the nav object
		// event handler fires, so that the nav object is correct
		adapter.onReanalyze = () => {
			setTimeout(() => {
				params.onReanalyze(adapter.navObject)
			}, 40)
		}

		lspClient.once("initialized", () => {
			setTimeout(() => {
				globals.events.emit("client-initialized")
				globals.clientInitialized = true
			}, 50)
		})
	}, logger)
}

globals.FindCallees = function(symbol: lsp.DocumentSymbol): Thenable<SymbolInfo[]> {
	if (!adapter) { return Promise.resolve([]) }
	return adapter.navObject.findCallees(symbol)
}

globals.FindCallers = function(pos: lsp.TextDocumentPositionParams): Thenable<SymbolInfo[]> {
	if (!adapter) { return Promise.resolve([]) }
	return adapter.navObject.findCallers(pos)
}

globals.Reanalyze = function(): void {
	if (!adapter || !lspClient) { return }

	adapter.reanalyze()
}

globals.ChangeFileAndReanalyze = function(newFile): void {
	adapter.changeFile(newFile)
	adapter.reanalyze()
}

globals.OpenSampleFile = function(): Thenable<string> {
	return promisify(fs.readFile)("samples/sample.py", { encoding: "utf8" })
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
