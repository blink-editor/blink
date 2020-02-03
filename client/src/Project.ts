/**
 * This class contains information about the users project as well as
 * providing basic project operations such as rename, save, etc.
 */
import { Context } from "./Context"
import { SymbolInfo } from "./nav-object"
import * as lsp from "vscode-languageserver-protocol"

export class Project {
	public readonly name: string
	public readonly directory: string
	public contexts: Context[] = []

	constructor(name: string, filePath: string) {
		this.name = name
		this.directory = filePath
	}

	// TODO: this isn't language-agnostic
	contextForUri(uri: string): Context | undefined {
		return this.contexts
			.filter((context) => context.uri == uri)
			[0]
	}

	contextForSymbol(symbol: SymbolInfo | lsp.SymbolInformation): Context | undefined {
		function isLspSymbolInformation(x: SymbolInfo | lsp.SymbolInformation): x is lsp.SymbolInformation {
			return (x as lsp.SymbolInformation).location !== undefined
		}

		const uri = isLspSymbolInformation(symbol) ? symbol.location.uri : symbol.uri

		return this.contextForUri(uri)
	}
}
