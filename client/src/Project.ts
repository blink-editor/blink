/**
 * This class contains information about the users project as well as
 * providing basic project operations such as rename, save, etc.
 */
import { Context, SymbolReference } from "./Context"

export interface ContextSymbolReference extends SymbolReference {
	context: Context
}

export class Project {
	public readonly uri: string | null
	public readonly name: string
	public contexts: Context[] = []

	constructor(uri: string | null, name: string) {
		this.uri = uri
		this.name = name
	}

	// TODO: this isn't language-agnostic
	contextForUri(uri: string): Context | undefined {
		return this.contexts
			.filter((context) => context.uri == uri)
			[0]
	}
}
