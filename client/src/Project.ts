/**
 * This class contains information about the users project as well as
 * providing basic project operations such as rename, save, etc.
 */
import { Context, SymbolReference } from "./Context"

export interface ContextSymbolReference extends SymbolReference {
	context: Context
}

export class Project {
	public contexts: Context[] = []

	// TODO: this isn't language-agnostic
	contextForUri(uri: string): Context | undefined {
		return this.contexts
			.filter((context) => context.uri == uri)
			[0]
	}
}
