// All of the Node.js APIs are available in the preload process.
// It has the same sandbox as a Chrome extension.
import * as client from "./langserver-client"
import * as CodeMirror from "codemirror"
import { CodeMirrorAdapter } from "./codemirror-adapter"
// css imported in html for now
// import "./codemirror-lsp.css"
import "codemirror/mode/python/python"
// import "codemirror/lib/codemirror.css"
// import "codemirror/theme/monokai.css"
import "codemirror/addon/hint/show-hint"
// import "codemirror/addon/hint/show-hint.css"

let lspClient: client.LspClient

;(window as any).CodeMirror = CodeMirror

;(window as any).ConfigureEditorAdapter = function(editor) {
	const logger = new client.ConsoleLogger()

	client.createTcpRpcConnection("localhost", 2087, (connection) => {
		const documentInfo: client.DocumentInfo = {
			languageId: "python",
			documentUri: "file:///untitled",
			rootUri: "file:///untitled",
			documentText: () => editor.getValue()
		}

		lspClient = new client.LspClientImpl(connection, documentInfo, logger)
		lspClient.initialize()

		// The adapter is what allows the editor to provide UI elements
		const adapter = new CodeMirrorAdapter(lspClient, {
			// UI-related options go here, allowing you to control the automatic features of the LSP, i.e.
			suggestOnTriggerCharacters: false
		}, editor)

		// You can also provide your own hooks:
		lspClient.on("error", (e) => {
			console.error(e)
		})

		// You might need to provide your own hooks to handle navigating to another file, for example:
		lspClient.on("goTo", (locations) => {
			// Do something to handle the URI in this object
		})

		// To clean up the adapter and connection:
		// adapter.remove()
		// lspClient.close()
	}, logger)
}
