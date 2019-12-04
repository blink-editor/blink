import * as lsp from "vscode-languageserver-protocol"

const supportedSymbols: lsp.SymbolKind[] = [
	lsp.SymbolKind.File,
	lsp.SymbolKind.Module,
	lsp.SymbolKind.Namespace,
	lsp.SymbolKind.Package,
	lsp.SymbolKind.Class,
	lsp.SymbolKind.Method,
	lsp.SymbolKind.Property,
	lsp.SymbolKind.Field,
	lsp.SymbolKind.Constructor,
	lsp.SymbolKind.Enum,
	lsp.SymbolKind.Interface,
	lsp.SymbolKind.Function,
	lsp.SymbolKind.Variable,
	lsp.SymbolKind.Constant,
	lsp.SymbolKind.String,
	lsp.SymbolKind.Number,
	lsp.SymbolKind.Boolean,
	lsp.SymbolKind.Array,
	lsp.SymbolKind.Object,
	lsp.SymbolKind.Key,
	lsp.SymbolKind.Null,
	lsp.SymbolKind.EnumMember,
	lsp.SymbolKind.Struct,
	lsp.SymbolKind.Event,
	lsp.SymbolKind.Operator,
	lsp.SymbolKind.TypeParameter,
]

export const clientCapabilities: lsp.ClientCapabilities = {
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
		documentSymbol: {
			dynamicRegistration: true,
			symbolKind: {
				valueSet: supportedSymbols,
			},
			hierarchicalDocumentSymbolSupport: false,
		}
	},
	workspace: {
		didChangeConfiguration: {
			dynamicRegistration: true,
		},
	},
}
