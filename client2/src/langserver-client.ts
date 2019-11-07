import * as net from "net"
import * as rpc from "vscode-jsonrpc"

class ConsoleLogger implements rpc.Logger, rpc.Tracer {
	error(message: string) {
		console.error(`[vscode-jsonrpc] ${message}`)
	}

	warn(message: string) {
		console.warn(`[vscode-jsonrpc] ${message}`)
	}

	info(message: string) {
		console.info(`[vscode-jsonrpc] ${message}`)
	}

	log(message: string, data?: string) {
		console.log(`[vscode-jsonrpc] ${message} ${data}`)
	}
}

export interface LspClient {
	connect(): void
	close(): void
}

export class LspTcpClient implements LspClient {
	private host: string
	private port: number
	private socket: net.Socket
	private connection: rpc.MessageConnection

	constructor(host: string, port: number) {
		this.host = host
		this.port = port
	}

	public connect() {
		this.socket = net.connect(this.port, this.host)

		const logger = new ConsoleLogger()

		this.connection = rpc.createMessageConnection(
			new rpc.SocketMessageReader(this.socket),
			new rpc.SocketMessageWriter(this.socket),
			logger)

		this.connection.onClose(() => {
			logger.log("onClose")
		})

		this.connection.onDispose(() => {
			logger.log("onDispose")
		})

		this.connection.onError((event) => {
			logger.log(`onError (${event})`)
		})

		this.connection.onUnhandledNotification((message) => {
			logger.log(`onUnhandledNotification (${message})`)
		})

		this.connection.onNotification((method, params) => {
			logger.log(`onNotification (${method}, ${params})`)
		})

		this.connection.onRequest((method, params) => {
			logger.log(`onRequest (${method}, ${params})`)
		})

		this.connection.trace(rpc.Trace.Verbose, logger)

		this.connection.listen()

		this.sendInitialize()
	}

	public close() {
		this.socket.end()
	}

	private sendInitialize() {
		const params = {
			capabilities: {
				textDocument: {
					hover: {
						dynamicRegistration: true,
						contentFormat: ["plaintext", "markdown"],
					},
					synchronization: {
						dynamicRegistration: true,
						willSave: false,
						didSave: false,
						willSaveWaitUntil: false,
					},
					completion: {
						dynamicRegistration: true,
						completionItem: {
							snippetSupport: false,
							commitCharactersSupport: true,
							documentationFormat: ["plaintext", "markdown"],
							deprecatedSupport: false,
							preselectSupport: false,
						},
						contextSupport: false,
					},
					signatureHelp: {
						dynamicRegistration: true,
						signatureInformation: {
							documentationFormat: ["plaintext", "markdown"],
						},
					},
					declaration: {
						dynamicRegistration: true,
						linkSupport: true,
					},
					definition: {
						dynamicRegistration: true,
						linkSupport: true,
					},
					typeDefinition: {
						dynamicRegistration: true,
						linkSupport: true,
					},
					implementation: {
						dynamicRegistration: true,
						linkSupport: true,
					},
				},
				workspace: {
					didChangeConfiguration: {
						dynamicRegistration: true,
					},
				},
				// xfilesProvider: true,
				// xcontentProvider: true,
			},
			// initializationOptions: null,
			// processId: null,
			// rootUri: this.documentInfo.rootUri,
			// workspaceFolders: null,
		}

		this.connection.sendRequest("initialize", params)
			.then((result) => {
				console.log(`got initialize result ${result}`)
			}, (e) => {
				console.log(`got initialize error ${e}`)
			})

		// const request = JSON.stringify({
		// 	jsonrpc: "2.0",
		// 	id: "HELLO",
		// 	method: "initialize",
		// 	params: params
		// })

		// const message = `Content-Length: ${request.length}\r\n\r\n${request}`

		// this.socket.write(message)

		// console.log("wrote request", "message")
	}
}
