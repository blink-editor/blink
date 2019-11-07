import { LspTcpClient } from "./langserver-client"

// All of the Node.js APIs are available in the preload process.
// It has the same sandbox as a Chrome extension.
(window as any).ConnectToServer = function() {
	const client = new LspTcpClient("localhost", 2087)
	client.connect()
}
