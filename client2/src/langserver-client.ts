import * as net from "net"

export interface LspClient {
	connect(): void
	close(): void
}

export class LspTcpClient implements LspClient {
	private host: string
	private port: number
  private socket: net.Socket
	private isConnected = false

	constructor(host: string, port: number) {
		this.host = host
		this.port = port
	}

	public connect() {
    this.socket = net.connect(this.port, this.host)

    this.socket.on("connect", () => {
      this.isConnected = true

      this.sendInitialize()
    })

    this.socket.on("data", (data) => {
      console.log("received data", data) // TODO
    })

    this.socket.on("close", (err) => {
      this.isConnected = false
    })
	}

	public close() {
		this.socket.end()
	}

	private sendInitialize() {
    if (!this.isConnected) {
      return
    }

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

    const request = JSON.stringify({
      jsonrpc: "2.0",
      id: "HELLO",
      method: "initialize",
      params: params
    })

    const message = `Content-Length: ${request.length}\r\n\r\n${request}`

    this.socket.write(message)

    console.log("wrote request", message)
	}
}
