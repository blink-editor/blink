// NOTES:
// nesting is determined by lines -- this can likely be improved, what if same line?
// bradley mentioned a better data structure to store ranges -- what is it and will it actually be faster?
// use SymbolInformation.containerName to find enclosing scope?

import * as lsp from "vscode-languageserver-protocol"
import { LspClient } from "./langserver-client"

function isSymbolInformationArray(symbols: lsp.DocumentSymbol[] | lsp.SymbolInformation[]): symbols is lsp.SymbolInformation[] {
	return (<lsp.SymbolInformation[]>symbols).length === 0 || (<lsp.SymbolInformation[]>symbols)[0].location !== undefined;
}

export class NavObject {

	symToInfo = {}

	constructor(client: LspClient) {
		client.on("documentSymbol", x => this.rebuildMaps(x))
	}

	/*
	 * Encodes a richSymbol into a string key.
	 * @param name  The name of the symbol.
	 * @param kind  The type of the symbol.
	 * @param uri   The URI of the file containing the symbol.
	 * @returns     A string that can be used as a unique key.
	 */
	encodeSymKey(name: string, kind: number, uri: string) {
		return JSON.stringify([name, kind, uri])
	}

	/*
	 * Rebuilds symToInfo. Should be called on file load, return, save.
	 */
	rebuildMaps(symbols: lsp.DocumentSymbol[] | lsp.SymbolInformation[]) {
		this.symToInfo = {}

		if (!isSymbolInformationArray(symbols)) {
			throw new Error("expected SymbolInformation[], got something else")
		}

		// add to data structure
		for (const symInfo of symbols) {
			const symKey: string = this.encodeSymKey(symInfo.name, symInfo.kind, symInfo.location.uri)
			this.symToInfo[symKey] = symInfo
		}
		console.log(this.symToInfo)
	}

	/*
	 * Finds the callers of a function whose name is at the position given. Should be called on navigate, return, save.
	 * @param symPos  A position object representing the position of the name of the function to find callers of.
	 * @returns       An array of SymbolInformation objects with ranges that enclose the definitions of calling functions.
	 */
	findCallers(symPos: lsp.TextDocumentPositionParams) { // pass position
		const output = []

		const request: lsp.ReferenceParams = {
		  textDocument: symPos.textDocument,
		  position: symPos.position,
		  context: {
			includeDeclaration: false,
		  },
		}

		/* request textDocument/references, receive Location[] */
		const result: lsp.Location[] = [
			{ uri: "file:///untitled", range: { start: { line: 1, character: 4 }, end: { line: 1, character: 10 } } },
			{ uri: "file:///untitled", range: { start: { line: 20, character: 4 }, end: { line: 20, character: 11 } } },
			{ uri: "file:///untitled", range: { start: { line: 6, character: 4 }, end: { line: 6, character: 12 } } }
		]

		// for each reference recieved, find parent scope
		for (const currRef of result) {
			let bestScore = null
			let bestKey = null

			// search for tightest enclosing scope for this reference
			for (const key in this.symToInfo) {
				const currRange = this.symToInfo[key].location.range
				// if currRange within refRange and holds a tighter line bound than best
				if (currRange.start.line <= currRef.range.start.line && currRange.end.line >= currRef.range.end.line
					&& (currRange.end.line - currRange.start.line < bestScore || bestScore === null)) {
						bestScore = currRange.end.line - currRange.start.line
						bestKey = key
				}
			}

			// if no parents to caller, was called from global scope, so ignore it
			if (bestKey !== null) {
				output.push(this.symToInfo[bestKey])
			}
		}
		return output
	}

	/*
	 * Finds the callers of a function whose name is at the position given. Should be called on navigate, return, save.
	 * @param doc  The pseudo-file document identifier.
	 * @returns    An array of SymbolInformation objects with ranges that enclose the definitions of functions being called in the given function.
	 */
	findCallees(doc: lsp.TextDocumentIdentifier) {
		// assuming the function is in its own pseudo-file denoted by uri
		const output = []
		const acceptableKinds: number[] = [1, 2] // add whatever kinds we want

		const request: lsp.CompletionParams = {
		  textDocument: doc,
		  position: { line: 0, character: 0 }, // TODO
		}

		/* request textDocument/completion with cursor at empty location, receive completionItem[] */
		const result: lsp.CompletionItem[] = [
			{ label: "class1", kind: 1 },
			{ label: "func1", kind: 2 },
			{ label: "var1", kind: 3 },
		]

		// for each completion received, find matching location
		for (const completion of result) {
			if (acceptableKinds.indexOf(completion.kind) >= 0) {
				// find completion's definition range
				const testSymKey: string = this.encodeSymKey(completion.label, completion.kind, doc.uri)
				const desiredInfo = this.symToInfo[testSymKey]
				// if not found, ignore it
				if (desiredInfo) {
					output.push(desiredInfo)
				}
			}
		}
		return output
	}
}

// test code
// const navObject: NavObject = new NavObject()
// navObject.rebuildMaps([ { name: "class1", kind: 1, location: { uri: "file:///untitled", range: { start: { line: 0, character: 0 }, end: { line: 10, character: 0 } } } },
// 	{ name: "func1", kind: 2, location: { uri: "file:///untitled", range: { start: { line: 4, character: 0 }, end: { line: 9, character: 10 } } } } ])
// console.log(navObject.findCallers({ textDocument: { uri: "file:///untitled" }, position: { line: 0, character: 10 }}))
// console.log(navObject.findCallees({ uri: "file://untitled" }))
