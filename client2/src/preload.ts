// All of the Node.js APIs are available in the preload process.
// It has the same sandbox as a Chrome extension.
import * as client from "./langserver-client"

let lspClient: client.LspClient

(window as any).ConnectToServer = function() {
	const logger = new client.ConsoleLogger()

	client.createTcpRpcConnection("localhost", 2087, (connection) => {
		const documentInfo: client.DocumentInfo = {
			languageId: "python",
			documentUri: "file:///Users/bradleywalters/school/cs4000/blink/server/pyls/__main__.py",
			rootUri: "file:///Users/bradleywalters/school/cs4000/blink/server/pyls/",
			documentText: () => "hello world"
		}

		lspClient = new client.LspClientImpl(connection, documentInfo, logger)
		lspClient.initialize()
	}, logger)
}
