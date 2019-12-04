// All of the Node.js APIs are available in the preload process.
// It has the same sandbox as a Chrome extension.
import * as client from "./langserver-client"
import * as lsp from "vscode-languageserver-protocol"
import * as events from "events"
import { ipcRenderer } from "electron"
import CodeMirror from "codemirror"
import { CodeMirrorAdapter } from "./codemirror-adapter"
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

const globals = {
	CodeMirror: CodeMirror,
} as Globals

window["globals"] = globals

globals.events = new GlobalEventsImpl()

ipcRenderer.once("server-connected", () => {
	globals.events.emit("server-connected")
	globals.serverConnected = true
})

globals.ConfigureEditorAdapter = function(editor, fileText, onChange, getLineOffset, onReanalyze) {
	const logger = new client.ConsoleLogger()

	client.createTcpRpcConnection("localhost", 2087, (connection) => {
		const documentInfo: client.DocumentInfo = {
			languageId: "python",
			documentUri: "untitled:///file",
			rootUri: null,
			initialText: fileText
		}

		lspClient = new client.LspClientImpl(connection, documentInfo, logger)
		lspClient.initialize()

		// The adapter is what allows the editor to provide UI elements
		adapter = new CodeMirrorAdapter(lspClient, {
			// UI-related options go here, allowing you to control the automatic features of the LSP, i.e.
			suggestOnTriggerCharacters: false
		}, editor)

		adapter.wholeFileText = documentInfo.initialText
		adapter.onChange = onChange
		adapter.getLineOffset = getLineOffset
		adapter.onReanalyze = () => {
			setTimeout(() => {
				onReanalyze((key) => adapter.navObject.findCachedSymbol(key))
			}, 50)
		}

		// You can also provide your own hooks:
		lspClient.on("error", (e) => {
			console.error(e)
		})

		// To clean up the adapter and connection:
		// adapter.remove()
		// lspClient.close()
	}, logger)
}

globals.FindCallees = function(contents: string): Thenable<lsp.SymbolInformation[]> {
	if (!adapter) { return Promise.resolve([]) }
	return adapter.navObject.findCallees(contents)
}

globals.FindCallers = function(pos: lsp.TextDocumentPositionParams): Thenable<lsp.SymbolInformation[]> {
	if (!adapter) { return Promise.resolve([]) }
	return adapter.navObject.findCallers(pos)
}

globals.Reanalyze = function(): void {
	if (!adapter || !lspClient) { return }

	adapter.reanalyze()
}
