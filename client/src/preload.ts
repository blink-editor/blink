// All of the Node.js APIs are available in the preload process.
// It has the same sandbox as a Chrome extension.
import * as client from "./langserver-client"
import * as lsp from "vscode-languageserver-protocol"
import CodeMirror from "codemirror"
import { CodeMirrorAdapter } from "./codemirror-adapter"
// css imported in html for now
// import "./codemirror-lsp.css"
import "codemirror/mode/python/python"
// import "codemirror/lib/codemirror.css"
// import "codemirror/theme/monokai.css"
import "codemirror/addon/hint/show-hint"
// import "codemirror/addon/hint/show-hint.css"

let lspClient: client.LspClient
let adapter: CodeMirrorAdapter

;(window as any).CodeMirror = CodeMirror

;(window as any).ConfigureEditorAdapter = function(editor, fileText, onChange, getLineOffset, onReanalyze) {
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
				onReanalyze(adapter.navObject.findCachedMain())
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

;(window as any).FindCallees = function(contents: string): Thenable<lsp.SymbolInformation[]> {
	if (!adapter) { return Promise.resolve([]) }
	return adapter.navObject.findCallees(contents)
}

;(window as any).FindCallers = function(pos: lsp.TextDocumentPositionParams): Thenable<lsp.SymbolInformation[]> {
	if (!adapter) { return Promise.resolve([]) }
	return adapter.navObject.findCallers(pos)
}

;(window as any).Reanalyze = function(): void {
	if (!adapter || !lspClient) { return }

	adapter.reanalyze()
}
