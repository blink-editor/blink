// ISC License (ISC)
// Copyright 2019 William Conlon
//
// Permission to use, copy, modify, and/or distribute this software for any
// purpose with or without fee is hereby granted, provided that the above
// copyright notice and this permission notice appear in all copies.
//
// THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
// WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
// MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
// SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER
// RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT,
// NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE
// USE OR PERFORMANCE OF THIS SOFTWARE.

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

	on(event: "completion", callback: (items: lsp.CompletionItem[]) => void): void
	on(event: "completionResolved", callback: (item: lsp.CompletionItem) => void): void
	on(event: "hover", callback: (hover: lsp.Hover) => void): void
	on(event: "diagnostic", callback: (diagnostic: lsp.PublishDiagnosticsParams) => void): void
	on(event: "highlight", callback: (highlights: lsp.DocumentHighlight[]) => void): void
	on(event: "signature", callback: (signatures: lsp.SignatureHelp) => void): void
	on(event: "goTo", callback: (location: lsp.Location | lsp.Location[] | lsp.LocationLink[] | null) => void): void
	on(event: "goToDef", callback: (location: lsp.Location | lsp.Location[] | lsp.LocationLink[] | null) => void): void
	on(event: "logging", callback: (log: any) => void): void
	on(event: "initialized", callback: () => void): void

	once(event: string, listener: (arg: any) => void): void

	off(event: string, listener: (...arg: any) => void): void

	/**
	 * Sends a document open notification to the server
	 */
	openDocument(documentInfo: DocumentInfo)

	/**
	 * Sends a document did save notification to the server
	 */
	saveDocument(textDocument: lsp.TextDocumentIdentifier, text: string)

	/**
	 * Sends a document close notification to the server
	 */
	closeDocument(uri: string)

	/**
	 * Returns whether or not a document with the given URI is open.
	 */
	isDocumentOpen(uri: string)

	/**
	 * Sets the current workspace folder.
	 */
	changeWorkspaceFolder(workspaceFolder: lsp.WorkspaceFolder)

	/**
	 * Sends a change to the document to the server
	 */
	sendChange(uri: string, change: lsp.TextDocumentContentChangeEvent): void

	/**
	 * Requests additional information for a particular character
	 */
	getHoverTooltip(uri: string, position: lsp.Position): void

	/**
	 * Request document symbol definitions from the server
	 */
	getDocumentSymbol(uri: string): Thenable<lsp.DocumentSymbol[] | lsp.SymbolInformation[] | null>

	/**
	 * Request possible completions from the server
	 */
	getCompletion(
		uri: string,
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
	getSignatureHelp(uri: string, position: lsp.Position): void
	/**
	 * Request all matching symbols in the document scope
	 */
	getDocumentHighlights(uri: string, position: lsp.Position): void
	/**
	 * Request a link to the definition of the current symbol. The results will not be displayed
	 * unless they are within the same file URI
	 */
	getDefinition(uri: string, position: lsp.Position): void
	/**
	 * Request a link to the type definition of the current symbol. The results will not be displayed
	 * unless they are within the same file URI
	 */
	getTypeDefinition(uri: string, position: lsp.Position): void
	/**
	 * Request a link to the implementation of the current symbol. The results will not be displayed
	 * unless they are within the same file URI
	 */
	getImplementation(uri: string, position: lsp.Position): void
	/**
	 * Request a link to all references to the current symbol. The results will not be displayed
	 * unless they are within the same file URI
	 */
	getReferences(uri: string, position: lsp.Position, includeDeclaration: boolean): void
	getReferences(uri: string, position: lsp.Position): void
	/**
	 * Request a workspace-wide rename of all references to the current symbol.
	 * Returns WorkspaceEdit or null.
	 */
	renameSymbol(params: lsp.RenameParams): Thenable<lsp.WorkspaceEdit | null>

	getLanguageCompletionCharacters(): string[]
	getLanguageSignatureCharacters(): string[]

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
	/**
	 * Does the server support rename?
	 */
	isRenameSupported(): boolean

	getBaseSettings(): lsp.DidChangeConfigurationParams

	changeConfiguration(settings: lsp.DidChangeConfigurationParams)

	/**
	 * Request used document symbols from the server
	 */
	getRayBensUsedDocumentSymbols(uri: string): Thenable<RayBensSymbolInformation[] | null>

	// TODO: refactor
	getReferencesWithRequest(request: lsp.ReferenceParams): Thenable<lsp.Location[] | null>
	getWorkspaceSymbols(query: string): Thenable<lsp.SymbolInformation[] | null>
}

export interface RayBensSymbolInformation extends lsp.SymbolInformation {
	rayBensModule: string | undefined
	rayBensUsageRange: lsp.Range
	rayBensBuiltin: boolean
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
	documentUri: string
	languageId: string
	initialText: string
}

export class LspClientImpl extends events.EventEmitter implements LspClient {
	// dependencies
	private connection: rpc.MessageConnection
	private logger?: rpc.Logger

	// lsp state
	private workspaceFolders: lsp.WorkspaceFolder[] = []
	private documents: { [uri: string]: lsp.TextDocumentItem } = {}

	private isInitialized = false
	private serverCapabilities: lsp.ServerCapabilities

	public getBaseSettings(): lsp.DidChangeConfigurationParams {
		return {
			// TODO: make settings language-server-agnostic
			settings: {
				pyls: {
					plugins: {
						pycodestyle: {
							enabled: false
						},
						ctags: {
							ctagsPath: "ctags", // path to ctags executable
							tagFiles: [],
							enabled: true
						}
					}
				}
			}
		}
	}

	/**
	 * Initializes an LspClient
	 *
	 * @param connection The underlying connection to transport messages
	 * @param logger     Logger
	 */
	constructor(connection: rpc.MessageConnection, logger?: rpc.Logger) {
		super()

		this.connection = connection
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
			logger?.error(`onError (${e})`)
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

	public sendInitialize() {

		const message: lsp.InitializeParams = {
			capabilities: clientCapabilities,
			// clientInfo: {
			// 	name: "blink",
			// 	version: "0.0.1",
			// },
			initializationOptions: null,
			processId: process.pid,
			rootUri: null,
			workspaceFolders: null,
			trace: "off",
		}

		this.connection.sendRequest("initialize", message).then((params: lsp.InitializeResult) => {
			this.isInitialized = true
			this.serverCapabilities = params.capabilities as lsp.ServerCapabilities

			this.connection.sendNotification("initialized")
			this.connection.sendNotification("workspace/didChangeConfiguration", {
				settings: this.getBaseSettings()
			})

			this.emit("initialized")
		}, (e) => {
			this.logger?.error(e)
		})
	}

	// TODO: support multiple workspace folders (Blink only needs one)
	public changeWorkspaceFolder(workspaceFolder: lsp.WorkspaceFolder) {
		const oldFolders = [...this.workspaceFolders]
		this.workspaceFolders = [workspaceFolder]

		// TODO: respond to server -> client workspace folder requests?

		this.connection.sendNotification("workspace/didChangeWorkspaceFolders", {
			event: {
				added: [...this.workspaceFolders],
				removed: oldFolders,
			},
			// https://github.com/palantir/python-language-server/issues/720
			added: [...this.workspaceFolders],
			removed: oldFolders,
		} as lsp.DidChangeWorkspaceFoldersParams)
	}

	public openDocument(documentInfo: DocumentInfo) {
		const documentItem: lsp.TextDocumentItem = {
			uri: documentInfo.documentUri,
			languageId: documentInfo.languageId,
			text: documentInfo.initialText,
			version: 0,
		}

		// TODO: assert that this document belongs to a workspace folder

		this.documents[documentItem.uri] = documentItem

		this.connection.sendNotification("textDocument/didOpen", {
			textDocument: documentItem,
		})
	}

	public saveDocument(textDocument: lsp.TextDocumentIdentifier, text: string) {
		this.logger?.log("Saving file" + textDocument.uri)
		this.connection.sendNotification("textDocument/didSave", {
			textDocument: textDocument,
			text: text
		})
	}

	public closeDocument(uri: string) {
		if (!this.documents[uri]) {
			return
		}

		delete this.documents[uri]

		this.connection.sendNotification("textDocument/didClose", {
			uri: uri
		})
	}

	public changeConfiguration(settings: lsp.DidChangeConfigurationParams) {
		this.connection.sendNotification("workspace/didChangeConfiguration", settings)
	}

	public isDocumentOpen(uri: string): boolean {
		return this.documents.hasOwnProperty(uri)
	}

	public sendChange(uri: string, change: lsp.TextDocumentContentChangeEvent) {
		if (!this.isInitialized || !this.documents[uri]) {
			return
		}

		const documentItem = this.documents[uri]

		const textDocumentChange: lsp.DidChangeTextDocumentParams = {
			textDocument: {
				uri: documentItem.uri,
				version: documentItem.version,
			},
			contentChanges: [change],
		}

		this.connection.sendNotification("textDocument/didChange", textDocumentChange)

		documentItem.version++
	}

	public getHoverTooltip(uri: string, position: lsp.Position) {
		if (!this.isInitialized || !this.documents[uri]) {
			return
		}

		this.connection.sendRequest("textDocument/hover", {
			textDocument: {
				uri: uri,
			},
			position: position,
		} as lsp.TextDocumentPositionParams).then((params: lsp.Hover) => {
			this.emit("hover", params)
		})
	}

	public getDocumentSymbol(uri: string): Thenable<lsp.DocumentSymbol[] | lsp.SymbolInformation[] | null> {
		if (!this.isInitialized || !this.documents[uri]) {
			return Promise.reject()
		}

		if (!(this.serverCapabilities && this.serverCapabilities.documentSymbolProvider)) {
			return Promise.reject()
		}

		return this.connection.sendRequest("textDocument/documentSymbol", {
			textDocument: {
				uri: uri,
			}
		} as lsp.DocumentSymbolParams)
	}

	public getCompletion(
		uri: string,
		position: lsp.Position,
		triggerCharacter?: string,
		triggerKind?: lsp.CompletionTriggerKind,
	) {
		if (!this.isInitialized || !this.documents[uri]) {
			return
		}

		if (!(this.serverCapabilities && this.serverCapabilities.completionProvider)) {
			return
		}

		this.connection.sendRequest("textDocument/completion", {
			textDocument: {
				uri: uri,
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

	public getSignatureHelp(uri: string, position: lsp.Position) {
		if (!this.isInitialized || !this.documents[uri]) {
			return
		}

		if (!(this.serverCapabilities && this.serverCapabilities.signatureHelpProvider)) {
			return
		}

		this.connection.sendRequest("textDocument/signatureHelp", {
			textDocument: {
				uri: uri,
			},
			position: position,
		} as lsp.TextDocumentPositionParams).then((params: lsp.SignatureHelp) => {
			this.emit("signature", params)
		})
	}

	/**
	 * Request the locations of all matching document symbols
	 */
	public getDocumentHighlights(uri: string, position: lsp.Position) {
		if (!this.isInitialized || !this.documents[uri]) {
			return
		}

		if (!(this.serverCapabilities && this.serverCapabilities.documentHighlightProvider)) {
			return
		}

		this.connection.sendRequest("textDocument/documentHighlight", {
			textDocument: {
				uri: uri,
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
	public getDefinition(uri: string, position: lsp.Position) {
		if (!this.isInitialized || !this.documents[uri] || !this.isDefinitionSupported()) {
			return
		}

		this.connection.sendRequest("textDocument/definition", {
			textDocument: {
				uri: uri,
			},
			position: position,
		} as lsp.TextDocumentPositionParams).then((result: lsp.Location | lsp.Location[] | lsp.LocationLink[] | null) => {
			this.emit("goToDef", result)
		})
	}

	/**
	 * Request a link to the type definition of the current symbol. The results will not be displayed
	 * unless they are within the same file URI
	 */
	public getTypeDefinition(uri: string, position: lsp.Position) {
		if (!this.isInitialized || !this.documents[uri] || !this.isTypeDefinitionSupported()) {
			return
		}

		this.connection.sendRequest("textDocument/typeDefinition", {
			textDocument: {
				uri: uri,
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
	public getImplementation(uri: string, position: lsp.Position) {
		if (!this.isInitialized || !this.documents[uri] || !this.isImplementationSupported()) {
			return
		}

		this.connection.sendRequest("textDocument/implementation", {
			textDocument: {
				uri: uri,
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
	public getReferences(uri: string, position: lsp.Position, includeDeclaration: boolean = false) {
		if (!this.isInitialized || !this.documents[uri] || !this.isReferencesSupported()) {
			return
		}

		this.connection.sendRequest("textDocument/references", {
			textDocument: {
				uri: uri,
			},
			position: position,
			context: {
				includeDeclaration: includeDeclaration
			}
		} as lsp.ReferenceParams).then((result: Location[] | null) => {
			this.emit("goTo", result)
		})
	}

	/**
	 * Request a workspace-wide rename of all references to the current symbol.
	 * Returns WorkspaceEdit or null.
	 */
	public renameSymbol(params: lsp.RenameParams): Thenable<lsp.WorkspaceEdit | null> {
		if (!this.isInitialized || !this.documents[params.textDocument.uri] || !this.isRenameSupported()) {
			return Promise.reject()
		}

		return this.connection.sendRequest("textDocument/rename", params)
	}

	public getRayBensUsedDocumentSymbols(uri: string): Thenable<RayBensSymbolInformation[] | null> {
		if (!this.isInitialized || !this.documents[uri]) {
			return Promise.reject()
		}

		return this.connection.sendRequest("textDocument/usedDocumentSymbol", {
			textDocument: {
				uri: uri,
			}
		} as lsp.DocumentSymbolParams)
	}

	public getReferencesWithRequest(request: lsp.ReferenceParams): Thenable<lsp.Location[] | null> {
		return this.connection.sendRequest("textDocument/references", request)
	}

	public getWorkspaceSymbols(query: string): Thenable<lsp.SymbolInformation[] | null> {
		return this.connection.sendRequest("workspace/symbol", { query: query })
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

	/**
	 * Does the server support rename?
	 */
	public isRenameSupported() {
		return !!(this.serverCapabilities && this.serverCapabilities.renameProvider)
	}
}
