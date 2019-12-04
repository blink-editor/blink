import * as net from "net"
import * as rpc from "vscode-jsonrpc"
import * as lsp from "vscode-languageserver-protocol"
import * as events from "events"
import { clientCapabilities } from "./client-capabilities"

export class ConsoleLogger implements rpc.Logger, rpc.Tracer {
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

//documentSymbol
export interface LspClient {
	initialize(): void

	on(event: "documentSymbol", callback: (symbols: lsp.DocumentSymbol[] | lsp.SymbolInformation[]) => void): void
	on(event: "completion", callback: (items: lsp.CompletionItem[]) => void): void
	on(event: "completionResolved", callback: (item: lsp.CompletionItem) => void): void
	on(event: "hover", callback: (hover: lsp.Hover) => void): void
	on(event: "diagnostic", callback: (diagnostic: lsp.PublishDiagnosticsParams) => void): void
	on(event: "highlight", callback: (highlights: lsp.DocumentHighlight[]) => void): void
	on(event: "signature", callback: (signatures: lsp.SignatureHelp) => void): void
	on(event: "goTo", callback: (location: lsp.Location | lsp.Location[] | lsp.LocationLink[] | null) => void): void
	on(event: "error", callback: (error: any) => void): void
	on(event: "logging", callback: (log: any) => void): void

  off(event: string, listener: (arg: any) => void): void

	/**
	 * Sends a change to the document to the server
	 */
	sendChange(change: lsp.TextDocumentContentChangeEvent): void

	/**
	 * Requests additional information for a particular character
	 */
	getHoverTooltip(position: lsp.Position): void

	getDocumentSymbol(): void
	/**
	 * Request possible completions from the server
	 */
	getCompletion(
		position: lsp.Position,
		triggerCharacter?: string,
		triggerKind?: lsp.CompletionTriggerKind,
	): void
	/**
	 * If the server returns incomplete information for completion items, more information can be requested
	 */
	getDetailedCompletion(item: lsp.CompletionItem): void
	/**
	 * Request possible signatures for the current method
	 */
	getSignatureHelp(position: lsp.Position): void
	/**
	 * Request all matching symbols in the document scope
	 */
	getDocumentHighlights(position: lsp.Position): void
	/**
	 * Request a link to the definition of the current symbol. The results will not be displayed
	 * unless they are within the same file URI
	 */
	getDefinition(position: lsp.Position): void
	/**
	 * Request a link to the type definition of the current symbol. The results will not be displayed
	 * unless they are within the same file URI
	 */
	getTypeDefinition(position: lsp.Position): void
	/**
	 * Request a link to the implementation of the current symbol. The results will not be displayed
	 * unless they are within the same file URI
	 */
	getImplementation(position: lsp.Position): void
	/**
	 * Request a link to all references to the current symbol. The results will not be displayed
	 * unless they are within the same file URI
	 */
	getReferences(position: lsp.Position, includeDeclaration: boolean): void
	getReferences(position: lsp.Position): void

	getLanguageCompletionCharacters(): string[]
	getLanguageSignatureCharacters(): string[]

	getDocumentUri(): string

	/**
	 * Does the server support go to definition?
	 */
	isDefinitionSupported(): boolean
	/**
	 * Does the server support go to type definition?
	 */
	isTypeDefinitionSupported(): boolean
	/**
	 * Does the server support go to implementation?
	 */
	isImplementationSupported(): boolean
	/**
	 * Does the server support find all references?
	 */
	isReferencesSupported(): boolean

	// TODO: refactor
	getUsedDocumentSymbols(contents: string, languageId: string): Promise<lsp.CompletionItem[] | null>
	getReferencesWithRequest(request: lsp.ReferenceParams): Thenable<lsp.Location[] | null>
}

export function createTcpRpcConnection(
	host: string,
	port: number,
	cb: ((connection: rpc.MessageConnection) => void),
	logger?: rpc.Logger
) {
	const socket = net.connect(port, host, () => {
		const connection = rpc.createMessageConnection(
			new rpc.SocketMessageReader(socket),
			new rpc.SocketMessageWriter(socket),
			logger)

		connection.onDispose(() => { socket.end() })
		connection.onClose(() => connection.dispose())

		cb(connection)
	})
}

const ServerCapabilitiesProviders = {
	"textDocument/hover": "hoverProvider",
	"textDocument/completion": "completionProvider",
	"textDocument/signatureHelp": "signatureHelpProvider",
	"textDocument/definition": "definitionProvider",
	"textDocument/typeDefinition": "typeDefinitionProvider",
	"textDocument/implementation": "implementationProvider",
	"textDocument/references": "referencesProvider",
	"textDocument/documentHighlight" : "documentHighlightProvider",
	"textDocument/documentSymbol" : "documentSymbolProvider",
	"textDocument/workspaceSymbol" : "workspaceSymbolProvider",
	"textDocument/codeAction" : "codeActionProvider",
	"textDocument/codeLens" : "codeLensProvider",
	"textDocument/documentFormatting" : "documentFormattingProvider",
	"textDocument/documentRangeFormatting" : "documentRangeFormattingProvider",
	"textDocument/documentOnTypeFormatting" : "documentOnTypeFormattingProvider",
	"textDocument/rename" : "renameProvider",
	"textDocument/documentLink" : "documentLinkProvider",
	"textDocument/color" : "colorProvider",
	"textDocument/foldingRange" : "foldingRangeProvider",
	"textDocument/declaration" : "declarationProvider",
	"textDocument/executeCommand" : "executeCommandProvider",
}

interface FlexibleServerCapabilities extends lsp.ServerCapabilities {
	[key: string]: any
}

function registerServerCapability(
	previous: lsp.ServerCapabilities,
	registration: lsp.Registration
): lsp.ServerCapabilities {
	const serverCapabilitiesCopy = JSON.parse(JSON.stringify(previous)) as FlexibleServerCapabilities
	const { method, registerOptions } = registration
	const providerName = ServerCapabilitiesProviders[method]

	if (providerName) {
		if (!registerOptions) {
			serverCapabilitiesCopy[providerName] = true
		} else {
			serverCapabilitiesCopy[providerName] = Object.assign({}, JSON.parse(JSON.stringify(registerOptions)))
		}
	} else {
		throw new Error(`Unknown server capability ${method}`)
	}

	return serverCapabilitiesCopy
}

function unregisterServerCapability(
	previous: lsp.ServerCapabilities,
	unregistration: lsp.Unregistration
): lsp.ServerCapabilities {
	const serverCapabilitiesCopy = JSON.parse(JSON.stringify(previous)) as FlexibleServerCapabilities
	const { method } = unregistration
	const providerName = ServerCapabilitiesProviders[method]

	delete serverCapabilitiesCopy[providerName]

	return serverCapabilitiesCopy
}

export interface DocumentInfo {
	languageId: string
	documentUri: string
	initialText: string
	/**
	 * The rootUri of the workspace. Is null if no folder is open.
	 */
	rootUri: string | null
}

export class LspClientImpl extends events.EventEmitter implements LspClient {
	private connection: rpc.MessageConnection
	private isInitialized = false
	private serverCapabilities: lsp.ServerCapabilities
	private documentVersion = 0
	private documentInfo: DocumentInfo
	private logger?: rpc.Logger

	constructor(
		connection: rpc.MessageConnection,
		documentInfo: DocumentInfo,
		logger?: rpc.Logger
	) {
		super()

		this.connection = connection
		this.documentInfo = documentInfo
		this.logger = logger

		// this.connection.onClose(() => {
		// 	logger?.log("onClose")
		// })

		// this.connection.onDispose(() => {
		// 	logger?.log("onDispose")
		// })

		// this.connection.onUnhandledNotification((message) => {
		// 	logger?.log(`onUnhandledNotification (${message})`)
		// })

		// this.connection.onNotification((method, params) => {
		// 	logger?.log(`onNotification (${method}, ${params})`)
		// })

		// this.connection.onRequest((method, params) => {
		// 	logger?.log(`onRequest (${method}, ${params})`)
		// })

		this.connection.onNotification("textDocument/publishDiagnostics", (
			params: lsp.PublishDiagnosticsParams,
		) => {
			this.emit("diagnostic", params)
		})

		this.connection.onNotification("window/showMessage", (params: lsp.ShowMessageParams) => {
			this.emit("logging", params)
		})

		this.connection.onRequest("client/registerCapability", (params: lsp.RegistrationParams) => {
			params.registrations.forEach((capabilityRegistration: lsp.Registration) => {
				this.serverCapabilities = registerServerCapability(this.serverCapabilities, capabilityRegistration)
			})

			this.emit("logging", params)
		})

		this.connection.onRequest("client/unregisterCapability", (params: lsp.UnregistrationParams) => {
			params.unregisterations.forEach((capabilityUnregistration: lsp.Unregistration) => {
				this.serverCapabilities = unregisterServerCapability(this.serverCapabilities, capabilityUnregistration)
			})

			this.emit("logging", params)
		})

		this.connection.onRequest("window/showMessageRequest", (params: lsp.ShowMessageRequestParams) => {
			this.emit("logging", params)
		})

		this.connection.onError((e) => {
			logger?.log(`onError (${event})`)
			this.emit("error", e)
		})

		if (logger !== undefined) {
			this.connection.trace(rpc.Trace.Verbose, logger)
		}
	}

	public initialize() {
		this.connection.listen()

		this.sendInitialize()
	}

	// TODO: do we need a close method

	public getDocumentUri() {
		return this.documentInfo.documentUri
	}

	public sendInitialize() {

		const message: lsp.InitializeParams = {
			capabilities: clientCapabilities,
			// clientInfo: {
			// 	name: "blink",
			// 	version: "0.0.1",
			// },
			initializationOptions: null,
			processId: null,
			rootUri: this.documentInfo.rootUri,
			workspaceFolders: null,
			trace: "off",
		}

		this.connection.sendRequest("initialize", message).then((params: lsp.InitializeResult) => {
			this.isInitialized = true
			this.serverCapabilities = params.capabilities as lsp.ServerCapabilities
			const textDocumentMessage: lsp.DidOpenTextDocumentParams = {
				textDocument: {
					uri: this.documentInfo.documentUri,
					languageId: this.documentInfo.languageId,
					text: this.documentInfo.initialText,
					version: this.documentVersion,
				} as lsp.TextDocumentItem,
			}
			this.connection.sendNotification("initialized")
			this.connection.sendNotification("workspace/didChangeConfiguration", {
				settings: {
					// TODO: make settings language-server-agnostic
					pyls: {
						plugins: {
							pycodestyle: {
								enabled: false
							}
						}
					}
				},
			})
			this.connection.sendNotification("textDocument/didOpen", textDocumentMessage)
		}, (e) => {
		})
	}

	public sendChange(change: lsp.TextDocumentContentChangeEvent) {
		if (!this.isInitialized) {
			return
		}
		const textDocumentChange: lsp.DidChangeTextDocumentParams = {
			textDocument: {
				uri: this.documentInfo.documentUri,
				version: this.documentVersion,
			} as lsp.VersionedTextDocumentIdentifier,
			contentChanges: [change],
		}
		this.connection.sendNotification("textDocument/didChange", textDocumentChange)
		this.documentVersion++
	}

	public getHoverTooltip(position: lsp.Position) {
		if (!this.isInitialized) {
			return
		}
		this.connection.sendRequest("textDocument/hover", {
			textDocument: {
				uri: this.documentInfo.documentUri,
			},
			position: position,
		} as lsp.TextDocumentPositionParams).then((params: lsp.Hover) => {
			this.emit("hover", params)
		})
	}

	public getDocumentSymbol(){
		if(!this.isInitialized){
			return
		}
		if (!(this.serverCapabilities && this.serverCapabilities.documentSymbolProvider)) {
			return
		}

		this.connection.sendRequest("textDocument/documentSymbol", {
			textDocument: {
				uri: this.documentInfo.documentUri,
			}
		} as lsp.DocumentSymbolParams).then((params: lsp.DocumentSymbol | lsp.DocumentSymbol[] | null) => {
			if (!params) {
				console.log("Document Symbol Request Returned Null")
				return
			}
			this.emit("documentSymbol", params)
		})
	}

	public getCompletion(
		position: lsp.Position,
		triggerCharacter?: string,
		triggerKind?: lsp.CompletionTriggerKind,
	) {
		if (!this.isInitialized) {
			return
		}
		if (!(this.serverCapabilities && this.serverCapabilities.completionProvider)) {
			return
		}

		this.connection.sendRequest("textDocument/completion", {
			textDocument: {
				uri: this.documentInfo.documentUri,
			},
			position: position,
			context: {
				triggerKind: triggerKind || lsp.CompletionTriggerKind.Invoked,
				triggerCharacter
			},
		} as lsp.CompletionParams).then((params: lsp.CompletionList | lsp.CompletionItem[] | null) => {
			if (!params) {
				this.emit("completion", params)
				return
			}
			this.emit("completion", "items" in params ? params.items : params)
		})
	}

	public getDetailedCompletion(completionItem: lsp.CompletionItem) {
		if (!this.isInitialized) {
			return
		}
		this.connection.sendRequest("completionItem/resolve", completionItem)
			.then((result: lsp.CompletionItem) => {
				this.emit("completionResolved", result)
			})
	}

	public getSignatureHelp(position: lsp.Position) {
		if (!this.isInitialized) {
			return
		}
		if (!(this.serverCapabilities && this.serverCapabilities.signatureHelpProvider)) {
			return
		}

		this.connection.sendRequest("textDocument/signatureHelp", {
			textDocument: {
				uri: this.documentInfo.documentUri,
			},
			position: position,
		} as lsp.TextDocumentPositionParams).then((params: lsp.SignatureHelp) => {
			this.emit("signature", params)
			console.log(params)
		})
	}

	/**
	 * Request the locations of all matching document symbols
	 */
	public getDocumentHighlights(position: lsp.Position) {
		if (!this.isInitialized) {
			return
		}
		if (!(this.serverCapabilities && this.serverCapabilities.documentHighlightProvider)) {
			return
		}

		this.connection.sendRequest("textDocument/documentHighlight", {
			textDocument: {
				uri: this.documentInfo.documentUri,
			},
			position: position,
		} as lsp.TextDocumentPositionParams).then((params: lsp.DocumentHighlight[]) => {
			this.emit("highlight", params)
		})
	}

	/**
	 * Request a link to the definition of the current symbol. The results will not be displayed
	 * unless they are within the same file URI
	 */
	public getDefinition(position: lsp.Position) {
		if (!this.isInitialized || !this.isDefinitionSupported()) {
			return
		}

		this.connection.sendRequest("textDocument/definition", {
			textDocument: {
				uri: this.documentInfo.documentUri,
			},
			position: position,
		} as lsp.TextDocumentPositionParams).then((result: lsp.Location | lsp.Location[] | lsp.LocationLink[] | null) => {
			this.emit("goTo", result)
		})
	}

	/**
	 * Request a link to the type definition of the current symbol. The results will not be displayed
	 * unless they are within the same file URI
	 */
	public getTypeDefinition(position: lsp.Position) {
		if (!this.isInitialized || !this.isTypeDefinitionSupported()) {
			return
		}

		this.connection.sendRequest("textDocument/typeDefinition", {
			textDocument: {
				uri: this.documentInfo.documentUri,
			},
			position: position,
		} as lsp.TextDocumentPositionParams).then((result: lsp.Location | lsp.Location[] | lsp.LocationLink[] | null) => {
			this.emit("goTo", result)
		})
	}

	/**
	 * Request a link to the implementation of the current symbol. The results will not be displayed
	 * unless they are within the same file URI
	 */
	public getImplementation(position: lsp.Position) {
		if (!this.isInitialized || !this.isImplementationSupported()) {
			return
		}

		this.connection.sendRequest("textDocument/implementation", {
			textDocument: {
				uri: this.documentInfo.documentUri,
			},
			position: position,
		} as lsp.TextDocumentPositionParams).then((result: lsp.Location | lsp.Location[] | lsp.LocationLink[] | null) => {
			this.emit("goTo", result)
		})
	}

	/**
	 * Request a link to all references to the current symbol. The results will not be displayed
	 * unless they are within the same file URI
	 */
	public getReferences(position: lsp.Position, includeDeclaration: boolean = false) {
		if (!this.isInitialized || !this.isReferencesSupported()) {
			return
		}

		this.connection.sendRequest("textDocument/references", {
			textDocument: {
				uri: this.documentInfo.documentUri,
			},
			position: position,
			context: {
				includeDeclaration: includeDeclaration
			}
		} as lsp.ReferenceParams).then((result: Location[] | null) => {
			this.emit("goTo", result)
		})
	}

	private sendOpenDocument(params: lsp.DidOpenTextDocumentParams): Promise<void> {
		this.connection.sendNotification("textDocument/didOpen", params)
		return Promise.resolve()
	}

	private sendCloseDocument(params: lsp.DidCloseTextDocumentParams): Promise<void> {
		this.connection.sendNotification("textDocument/didClose", params)
		return Promise.resolve()
	}

	public getUsedDocumentSymbols(contents: string, languageId: string): Promise<lsp.CompletionItem[] | null> {
		const uri = "untitled:///temp-" + Date.now() // TODO

		const openParams: lsp.DidOpenTextDocumentParams = {
			textDocument: {
				uri: uri,
				languageId: languageId,
				text: contents,
				version: 0,
			} as lsp.TextDocumentItem,
		}

		const symbolParams: lsp.DocumentSymbolParams = {
			textDocument: {
				uri: uri
			},
		}

		const closeParams: lsp.DidCloseTextDocumentParams = {
			textDocument: {
				uri: uri
			}
		}

		return this.sendOpenDocument(openParams)
			.then(() => this.connection.sendRequest("textDocument/usedDocumentSymbol", symbolParams))
			.then((response: lsp.CompletionItem[] | null) => {
				return this.sendCloseDocument(closeParams)
					.then(() => Promise.resolve(response))
			})
	}

	public getReferencesWithRequest(request: lsp.ReferenceParams): Thenable<lsp.Location[] | null> {
		return this.connection.sendRequest("textDocument/references", request)
	}

	/**
	 * The characters that trigger completion automatically.
	 */
	public getLanguageCompletionCharacters(): string[] {
		if (!this.isInitialized) {
			return []
		}
		if (!(
			this.serverCapabilities &&
			this.serverCapabilities.completionProvider &&
			this.serverCapabilities.completionProvider.triggerCharacters
		)) {
			return []
		}
		return this.serverCapabilities.completionProvider.triggerCharacters
	}

	/**
	 * The characters that trigger signature help automatically.
	 */
	public getLanguageSignatureCharacters(): string[] {
		if (!this.isInitialized) {
			return []
		}
		if (!(
			this.serverCapabilities &&
			this.serverCapabilities.signatureHelpProvider &&
			this.serverCapabilities.signatureHelpProvider.triggerCharacters
		)) {
			return []
		}
		return this.serverCapabilities.signatureHelpProvider.triggerCharacters
	}

	/**
	 * Does the server support go to definition?
	 */
	public isDefinitionSupported() {
		return !!(this.serverCapabilities && this.serverCapabilities.definitionProvider)
	}

	/**
	 * Does the server support go to type definition?
	 */
	public isTypeDefinitionSupported() {
		return !!(this.serverCapabilities && this.serverCapabilities.typeDefinitionProvider)
	}

	/**
	 * Does the server support go to implementation?
	 */
	public isImplementationSupported() {
		return !!(this.serverCapabilities && this.serverCapabilities.implementationProvider)
	}

	/**
	 * Does the server support find all references?
	 */
	public isReferencesSupported() {
		return !!(this.serverCapabilities && this.serverCapabilities.referencesProvider)
	}
}
