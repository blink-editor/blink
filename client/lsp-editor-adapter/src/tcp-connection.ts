import * as net from 'net'
import * as events from 'events'
import * as lsProtocol from 'vscode-languageserver-protocol'
import { LocationLink, ServerCapabilities } from 'vscode-languageserver-protocol'
import { registerServerCapability, unregisterServerCapability } from './server-capability-registration'
import { ILspConnection, ILspOptions, IPosition, ITokenInfo } from './types'

interface IFilesServerClientCapabilities {
  /* ... all fields from the base ClientCapabilities ... */

  /**
   * The client provides support for workspace/xfiles.
   */
  xfilesProvider?: boolean
  /**
   * The client provides support for textDocument/xcontent.
   */
  xcontentProvider?: boolean
}
type ExtendedClientCapabilities = lsProtocol.ClientCapabilities & IFilesServerClientCapabilities

class LspTcpConnection extends events.EventEmitter implements ILspConnection {
  private isConnected = false
  private isInitialized = false
  private documentInfo: ILspOptions
  private serverCapabilities: lsProtocol.ServerCapabilities
  private documentVersion = 0
  private socket: net.Socket

  constructor(options: ILspOptions) {
    super()
    this.documentInfo = options
  }

  /**
   * Initialize a connection over a web socket that speaks the LSP protocol
   */
  public connect(socket: net.Socket): this {
    this.socket = socket

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

    /*
    this.connection.onNotification('textDocument/publishDiagnostics', (
      params: lsProtocol.PublishDiagnosticsParams,
    ) => {
      this.emit('diagnostic', params);
    });

    this.connection.onNotification('window/showMessage', (params: lsProtocol.ShowMessageParams) => {
      this.emit('logging', params);
    });

    this.connection.onRequest('client/registerCapability', (params: lsProtocol.RegistrationParams) => {
      params.registrations.forEach((capabilityRegistration: lsProtocol.Registration) => {
        this.serverCapabilities = registerServerCapability(this.serverCapabilities, capabilityRegistration);
      });

      this.emit('logging', params);
    });

    this.connection.onRequest('client/unregisterCapability', (params: lsProtocol.UnregistrationParams) => {
      params.unregisterations.forEach((capabilityUnregistration: lsProtocol.Unregistration) => {
        this.serverCapabilities = unregisterServerCapability(this.serverCapabilities, capabilityUnregistration);
      });

      this.emit('logging', params);
    });

    this.connection.onRequest('window/showMessageRequest', (params: lsProtocol.ShowMessageRequestParams) => {
      this.emit('logging', params);
    });

    this.connection.onError((e) => {
      this.emit('error', e);
    });
    */

    return this;
  }

  public close() {
    this.socket.end();
  }

  public getDocumentUri() {
    return this.documentInfo.documentUri;
  }

  public sendInitialize() {
    if (!this.isConnected) {
      return;
    }

    const message: lsProtocol.InitializeParams = {
      capabilities: {
        textDocument: {
          hover: {
            dynamicRegistration: true,
            contentFormat: ['plaintext', 'markdown'],
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
              documentationFormat: ['plaintext', 'markdown'],
              deprecatedSupport: false,
              preselectSupport: false,
            },
            contextSupport: false,
          },
          signatureHelp: {
            dynamicRegistration: true,
            signatureInformation: {
              documentationFormat: ['plaintext', 'markdown'],
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
        } as ExtendedClientCapabilities,
        workspace: {
          didChangeConfiguration: {
            dynamicRegistration: true,
          },
        } as lsProtocol.WorkspaceClientCapabilities,
        // xfilesProvider: true,
        // xcontentProvider: true,
      } as lsProtocol.ClientCapabilities,
      initializationOptions: null,
      processId: null,
      rootUri: this.documentInfo.rootUri,
      workspaceFolders: null,
    };

    const request = JSON.stringify({
      jsonrpc: "2.0",
      method: "initialize",
      params: message
    })
    this.socket.write(request)
    console.log("wrote request")

    /*
    this.client.request('initialize', message).then((params) => {
      this.isInitialized = true;
      this.serverCapabilities = params.capabilities as ServerCapabilities;
      const textDocumentMessage: lsProtocol.DidOpenTextDocumentParams = {
        textDocument: {
          uri: this.documentInfo.documentUri,
          languageId: this.documentInfo.languageId,
          text: this.documentInfo.documentText(),
          version: this.documentVersion,
        } as lsProtocol.TextDocumentItem,
      };
      this.client.request('initialized', [], null);
      this.client.request('workspace/didChangeConfiguration', {
        settings: {},
      }, null);
      this.client.request('textDocument/didOpen', textDocumentMessage, null);
      this.sendChange();
    }, (e) => {
    });
    */
  }

  public sendChange() {
    if (!this.isConnected) {
      return;
    }
    const textDocumentChange: lsProtocol.DidChangeTextDocumentParams = {
      textDocument: {
        uri: this.documentInfo.documentUri,
        version: this.documentVersion,
      } as lsProtocol.VersionedTextDocumentIdentifier,
      contentChanges: [{
        text: this.documentInfo.documentText(),
      }],
    };
    // this.client.request('textDocument/didChange', textDocumentChange, null);
    this.documentVersion++;
  }

  public getHoverTooltip(location: IPosition) {
    if (!this.isInitialized) {
      return;
    }
    /*
    this.client.request('textDocument/hover', {
      textDocument: {
        uri: this.documentInfo.documentUri,
      },
      position: {
        line: location.line,
        character: location.ch,
      },
    } as lsProtocol.TextDocumentPositionParams).then((params: lsProtocol.Hover) => {
      this.emit('hover', params);
    });
    */
  }

  public getCompletion(
    location: IPosition,
    token: ITokenInfo,
    triggerCharacter?: string,
    triggerKind?: lsProtocol.CompletionTriggerKind,
  ) {
    if (!this.isConnected) {
      return;
    }
    if (!(this.serverCapabilities && this.serverCapabilities.completionProvider)) {
      return;
    }

    /*
    this.client.request('textDocument/completion', {
      textDocument: {
        uri: this.documentInfo.documentUri,
      },
      position: {
        line: location.line,
        character: location.ch,
      },
      context: {
        triggerKind: triggerKind || lsProtocol.CompletionTriggerKind.Invoked,
        triggerCharacter,
      },
    } as lsProtocol.CompletionParams).then((params: lsProtocol.CompletionList | lsProtocol.CompletionItem[] | null) => {
      if (!params) {
        this.emit('completion', params);
        return;
      }
      this.emit('completion', 'items' in params ? params.items : params);
    });
    */
  }

  public getDetailedCompletion(completionItem: lsProtocol.CompletionItem) {
    if (!this.isConnected) {
      return;
    }
    /*
    this.client.request('completionItem/resolve', completionItem)
      .then((result: lsProtocol.CompletionItem) => {
        this.emit('completionResolved', result);
      });
    */
  }

  public getSignatureHelp(location: IPosition) {
    if (!this.isConnected) {
      return;
    }
    if (!(this.serverCapabilities && this.serverCapabilities.signatureHelpProvider)) {
      return;
    }

    const code = this.documentInfo.documentText();
    const lines = code.split('\n');
    const typedCharacter = lines[location.line][location.ch];

    if (
      this.serverCapabilities.signatureHelpProvider &&
      !this.serverCapabilities.signatureHelpProvider.triggerCharacters.indexOf(typedCharacter)
    ) {
      // Not a signature character
      return;
    }

    /*
    this.client.request('textDocument/signatureHelp', {
      textDocument: {
        uri: this.documentInfo.documentUri,
      },
      position: {
        line: location.line,
        character: location.ch,
      },
    } as lsProtocol.TextDocumentPositionParams).then((params: lsProtocol.SignatureHelp) => {
      this.emit('signature', params);
    });
    */
  }

  /**
   * Request the locations of all matching document symbols
   */
  public getDocumentHighlights(location: IPosition) {
    if (!this.isConnected) {
      return;
    }
    if (!(this.serverCapabilities && this.serverCapabilities.documentHighlightProvider)) {
      return;
    }

    /*
    this.client.request('textDocument/documentHighlight', {
      textDocument: {
        uri: this.documentInfo.documentUri,
      },
      position: {
        line: location.line,
        character: location.ch,
      },
    } as lsProtocol.TextDocumentPositionParams).then((params: lsProtocol.DocumentHighlight[]) => {
      this.emit('highlight', params);
    });
    */
  }

  /**
   * Request a link to the definition of the current symbol. The results will not be displayed
   * unless they are within the same file URI
   */
  public getDefinition(location: IPosition) {
    if (!this.isConnected || !this.isDefinitionSupported()) {
      return;
    }

    /*
    this.client.request('textDocument/definition', {
      textDocument: {
        uri: this.documentInfo.documentUri,
      },
      position: {
        line: location.line,
        character: location.ch,
      },
    } as lsProtocol.TextDocumentPositionParams).then((result: Location | Location[] | LocationLink[] | null) => {
      this.emit('goTo', result);
    });
    */
  }

  /**
   * Request a link to the type definition of the current symbol. The results will not be displayed
   * unless they are within the same file URI
   */
  public getTypeDefinition(location: IPosition) {
    if (!this.isConnected || !this.isTypeDefinitionSupported()) {
      return;
    }

    /*
    this.client.request('textDocument/typeDefinition', {
      textDocument: {
        uri: this.documentInfo.documentUri,
      },
      position: {
        line: location.line,
        character: location.ch,
      },
    } as lsProtocol.TextDocumentPositionParams).then((result: Location | Location[] | LocationLink[] | null) => {
      this.emit('goTo', result);
    });
    */
  }

  /**
   * Request a link to the implementation of the current symbol. The results will not be displayed
   * unless they are within the same file URI
   */
  public getImplementation(location: IPosition) {
    if (!this.isConnected || !this.isImplementationSupported()) {
      return;
    }

    /*
    this.client.request('textDocument/implementation', {
      textDocument: {
        uri: this.documentInfo.documentUri,
      },
      position: {
        line: location.line,
        character: location.ch,
      },
    } as lsProtocol.TextDocumentPositionParams).then((result: Location | Location[] | LocationLink[] | null) => {
      this.emit('goTo', result);
    });
    */
  }

  /**
   * Request a link to all references to the current symbol. The results will not be displayed
   * unless they are within the same file URI
   */
  public getReferences(location: IPosition) {
    if (!this.isConnected || !this.isReferencesSupported()) {
      return;
    }

    /*
    this.client.request('textDocument/references', {
      textDocument: {
        uri: this.documentInfo.documentUri,
      },
      position: {
        line: location.line,
        character: location.ch,
      },
    } as lsProtocol.ReferenceParams).then((result: Location[] | null) => {
      this.emit('goTo', result);
    });
    */
  }

  /**
   * The characters that trigger completion automatically.
   */
  public getLanguageCompletionCharacters(): string[] {
    if (!this.isConnected) {
      return;
    }
    if (!(
      this.serverCapabilities &&
      this.serverCapabilities.completionProvider &&
      this.serverCapabilities.completionProvider.triggerCharacters
    )) {
      return [];
    }
    return this.serverCapabilities.completionProvider.triggerCharacters;
  }

  /**
   * The characters that trigger signature help automatically.
   */
  public getLanguageSignatureCharacters(): string[] {
    if (!this.isConnected) {
      return;
    }
    if (!(
      this.serverCapabilities &&
      this.serverCapabilities.signatureHelpProvider &&
      this.serverCapabilities.signatureHelpProvider.triggerCharacters
    )) {
      return [];
    }
    return this.serverCapabilities.signatureHelpProvider.triggerCharacters;
  }

  /**
   * Does the server support go to definition?
   */
  public isDefinitionSupported() {
    return !!(this.serverCapabilities && this.serverCapabilities.definitionProvider);
  }

  /**
   * Does the server support go to type definition?
   */
  public isTypeDefinitionSupported() {
    return !!(this.serverCapabilities && this.serverCapabilities.typeDefinitionProvider);
  }

  /**
   * Does the server support go to implementation?
   */
  public isImplementationSupported() {
    return !!(this.serverCapabilities && this.serverCapabilities.implementationProvider);
  }

  /**
   * Does the server support find all references?
   */
  public isReferencesSupported() {
    return !!(this.serverCapabilities && this.serverCapabilities.referencesProvider);
  }
}

export default LspTcpConnection;
