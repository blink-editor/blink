/// <reference types="@types/codemirror" />
/// <reference types="@types/codemirror/codemirror-showhint" />

import debounce from "lodash.debounce"
import * as lsp from "vscode-languageserver-protocol"
import { Location, LocationLink, MarkupContent } from "vscode-languageserver-protocol"
import { LspClient } from "./langserver-client"
import { NavObject, SymbolInfo } from "./nav-object"

interface IScreenCoord {
	x: number
	y: number
}

/**
 * Configuration map for codeActionsOnSave
 */
export interface ICodeActionsOnSaveOptions {
  [kind: string]: boolean
}

export interface ITextEditorOptions {
  /**
   * Enable the suggestion box to pop-up on trigger characters.
   * Defaults to true.
   */
  suggestOnTriggerCharacters?: boolean
  /**
   * Accept suggestions on ENTER.
   * Defaults to "on".
   */
  acceptSuggestionOnEnter?: boolean | "on" | "smart" | "off"
  /**
   * Accept suggestions on TAB.
   * Defaults to "on".
   */
  acceptSuggestionOnTab?: boolean | "on" | "smart" | "off"
  /**
   * Accept suggestions on provider defined characters.
   * Defaults to true.
   */
  acceptSuggestionOnCommitCharacter?: boolean
  /**
   * Enable selection highlight.
   * Defaults to true.
   */
  selectionHighlight?: boolean
  /**
   * Enable semantic occurrences highlight.
   * Defaults to true.
   */
  occurrencesHighlight?: boolean
  /**
   * Show code lens
   * Defaults to true.
   */
  codeLens?: boolean
  /**
   * Code action kinds to be run on save.
   */
  codeActionsOnSave?: ICodeActionsOnSaveOptions
  /**
   * Timeout for running code actions on save.
   */
  codeActionsOnSaveTimeout?: number
  /**
   * Enable code folding
   * Defaults to true.
   */
  folding?: boolean
  /**
   * Selects the folding strategy. "auto" uses the strategies contributed for the current document,
   * "indentation" uses the indentation based folding strategy.
   * Defaults to "auto".
   */
  foldingStrategy?: "auto" | "indentation"
  /**
   * Controls whether the fold actions in the gutter stay always visible or hide unless the mouse is over the gutter.
   * Defaults to "mouseover".
   */
  showFoldingControls?: "always" | "mouseover"
  /**
   * Whether to suggest while typing
   */
  suggest?: boolean
  /**
   * Debounce (in ms) for suggestions while typing.
   * Defaults to 200ms
   */
  debounceSuggestionsWhileTyping?: number
  /**
   * Enable quick suggestions (shadow suggestions)
   * Defaults to true.
   */
  quickSuggestions?: boolean | {
      other: boolean
      comments: boolean
      strings: boolean
  }
  /**
   * Quick suggestions show delay (in ms)
   * Defaults to 200 (ms)
   */
  quickSuggestionsDelay?: number
  /**
   * Parameter hint options. Defaults to true.
   */
  enableParameterHints?: boolean
  /**
   * Render icons in suggestions box.
   * Defaults to true.
   */
  iconsInSuggestions?: boolean
  /**
   * Enable format on type.
   * Defaults to false.
   */
  formatOnType?: boolean
  /**
   * Enable format on paste.
   * Defaults to false.
   */
  formatOnPaste?: boolean
}

interface TokenInfo {
	start: CodeMirror.Position
	end: CodeMirror.Position
	text: string
}

/**
 * An adapter is responsible for connecting a particular text editor with a LSP connection
 * and will send messages over the connection and display responses in the editor
 */
export abstract class IEditorAdapter<T> {
  constructor(connection: LspClient, options: ITextEditorOptions, editor: T) {}

  /**
   * Removes the adapter from the editor and closes the connection
   */
  public abstract remove(): void
}

function getFilledDefaults(options: ITextEditorOptions): ITextEditorOptions {
  return Object.assign({}, {
    suggestOnTriggerCharacters: true,
    acceptSuggestionOnEnter: true,
    acceptSuggestionOnTab: true,
    acceptSuggestionOnCommitCharacter: true,
    selectionHighlight: true,
    occurrencesHighlight: true,
    codeLens: true,
    folding: true,
    foldingStrategy: "auto",
    showFoldingControls: "mouseover",
    suggest: true,
    debounceSuggestionsWhileTyping: 200,
    quickSuggestions: true,
    quickSuggestionsDelay: 200,
    enableParameterHints: true,
    iconsInSuggestions: true,
    formatOnType: false,
    formatOnPaste: false,
  }, options)
}

export class CodeMirrorAdapter extends IEditorAdapter<CodeMirror.Editor> {
	public options: ITextEditorOptions
	public editor: CodeMirror.Editor
	public connection: LspClient
	public navObject: NavObject

	private hoverMarker?: CodeMirror.TextMarker
	private signatureWidget?: CodeMirror.LineWidget
	private token: TokenInfo
	private markedDiagnostics: CodeMirror.TextMarker[] = []
	private highlightMarkers: CodeMirror.TextMarker[] = []
	private hoverCharacter: CodeMirror.Position
	private debouncedGetHover: (position: CodeMirror.Position) => void
	private connectionListeners: { [key: string]: () => void } = {}
	private editorListeners: { [key: string]: () => void } = {}
	private documentListeners: { [key: string]: () => void } = {}
	private tooltip: HTMLElement
	private isShowingContextMenu: boolean = false

	// TODO: refactor
	private document: lsp.TextDocumentIdentifier | null
	public onChange: (text: string) => string
	public getLineOffset: () => number
	public onGoToLocation: (loc: lsp.Location) => void
	public openRenameSymbol: (at: lsp.TextDocumentPositionParams) => void

	constructor(connection: LspClient, navObject: NavObject, options: ITextEditorOptions, editor: CodeMirror.Editor) {
		super(connection, options, editor)
		this.connection = connection
		this.options = getFilledDefaults(options)
		this.editor = editor
		this.navObject = navObject

		this.debouncedGetHover = debounce((position: CodeMirror.Position) => {
			this.connection.getHoverTooltip(this.document!.uri, this._docPositionToLsp(position))
		}, this.options.quickSuggestionsDelay)

		this._addListeners()
	}

	private _docPositionToLsp(pos: CodeMirror.Position): lsp.Position {
		return {
			line: pos.line + this.getLineOffset(),
			character: pos.ch,
		}
	}

	private _lspPositionToDoc(pos: lsp.Position): CodeMirror.Position {
		return {
			line: pos.line - this.getLineOffset(),
			ch: pos.character,
		}
	}

	public handleMouseOver(ev: MouseEvent) {
		if (this.isShowingContextMenu || !this._isEventInsideVisible(ev) || !this._isEventOnCharacter(ev)) {
			return
		}

		const docPosition: CodeMirror.Position = this.editor.coordsChar({
			left: ev.clientX,
			top: ev.clientY,
		}, "window")

		if (
			!(this.hoverCharacter &&
			docPosition.line === this.hoverCharacter.line && docPosition.ch === this.hoverCharacter.ch)
		) {
			// Avoid sending duplicate requests in a row
			this.hoverCharacter = docPosition
			this.debouncedGetHover(docPosition)
		}
	}

	public handleChange(cm: CodeMirror.Editor, change: CodeMirror.EditorChange) {
		// call the onChange method to get the whole file
		const editorCode = this.editor.getValue()
		if (change.origin !== "setValue") {
			const lspCode = this.onChange(editorCode)
			// send the change to the server so it's up to date
			this.connection.sendChange(this.document!.uri, { text: lspCode })
		}



		const editorLocation = this.editor.getDoc().getCursor("end")
		const lspLocation: lsp.Position = this._docPositionToLsp(editorLocation)

		const editorLines = editorCode.split("\n")
		const editorLine = editorLines[editorLocation.line]
		const typedCharacter = editorLine[editorLocation.ch - 1]

		const completionCharacters = this.connection.getLanguageCompletionCharacters()
		const signatureCharacters = this.connection.getLanguageSignatureCharacters()

		if (typeof typedCharacter === "undefined") {
			// Line was cleared
			this._removeSignatureWidget()
		} else if (completionCharacters.indexOf(typedCharacter) > -1) {
			this.token = this._getTokenEndingAtPosition(editorCode, editorLocation, completionCharacters)
			this.connection.getCompletion(
				this.document!.uri,
				lspLocation,
				completionCharacters.find((c) => c === typedCharacter),
				lsp.CompletionTriggerKind.TriggerCharacter,
			)
		} else if (signatureCharacters.indexOf(typedCharacter) > -1) {
			this.token = this._getTokenEndingAtPosition(editorCode, editorLocation, signatureCharacters)
			this.connection.getSignatureHelp(this.document!.uri, lspLocation)
		} else if (!/\W/.test(typedCharacter)) {
			this.connection.getCompletion(
				this.document!.uri,
				lspLocation,
				"",
				lsp.CompletionTriggerKind.Invoked,
			)
			this.token = this._getTokenEndingAtPosition(editorCode, editorLocation, completionCharacters.concat(signatureCharacters))
		} else {
			this._removeSignatureWidget()
		}
	}

	public changeOwnedFile(uri: string, contents: string) {
		this.document = { uri: uri }
		this.connection.sendChange(uri, { text: contents })
		this._removeSignatureWidget()
	}

	/**
	 * Handles all Document Symbol responses from server.
	 * textDocument/documentSymbol
	 * @param  response DocumentSymbol: Information of all symbols in the given file.
	 * @return          void
	 */
	public handleDocumentSymbol(response: lsp.DocumentSymbol) {
		// Note: This is where the depencency graph will gets its data...
	}

	public handleHover(response: lsp.Hover) {
		this._removeHover()
		this._removeTooltip()

		if (!response || !response.contents || (Array.isArray(response.contents) && response.contents.length === 0)) {
			return
		}

		let start: CodeMirror.Position = this.hoverCharacter
		let end: CodeMirror.Position = this.hoverCharacter

		if (response.range) {
			start = this._lspPositionToDoc(response.range.start)
			end = this._lspPositionToDoc(response.range.end)

			this.hoverMarker = this.editor.getDoc().markText(start, end, {
				css: "text-decoration: underline",
			})
		}

		let tooltipText
		if (MarkupContent.is(response.contents)) {
			tooltipText = response.contents.value
		} else if (Array.isArray(response.contents)) {
			const firstItem = response.contents[0]
			if (MarkupContent.is(firstItem)) {
				tooltipText = firstItem.value
			} else if (firstItem === null) {
				return
			} else if (typeof firstItem === "object") {
				tooltipText = firstItem.value
			} else {
				tooltipText = firstItem
			}
		} else if (typeof response.contents === "string") {
			tooltipText = response.contents
		}

		const htmlElement = document.createElement("div")
		htmlElement.innerText = tooltipText
		const coords = this.editor.charCoords(start, "page")
		this._showTooltip(htmlElement, {
			x: coords.left,
			y: coords.top,
		})
	}

	public handleHighlight(items: lsp.DocumentHighlight[]) {
		this._highlightRanges((items || []).map((i) => i.range))
	}

	public handleCompletion(completions: lsp.CompletionItem[]): void {
		if (!this.token) {
			return
		}

		const bestCompletions = this._getFilteredCompletions(this.token.text, completions)

		let start = this.token.start
		if (/^\W$/.test(this.token.text)) {
			// Special case for completion on the completion trigger itself, the completion goes after
			start = this.token.end
		}

		this.editor.showHint({
			completeSingle: false,
			hint: () => {
				return {
					from: start,
					to: this.token.end,
					list: bestCompletions.map((completion) => completion.label),
				}
			},
		} as CodeMirror.ShowHintOptions)
	}

	public handleDiagnostic(response: lsp.PublishDiagnosticsParams) {
		if (response.uri !== this.document?.uri) {
			console.warn("received diagnostics for uri", response.uri, "not ours", this.document?.uri)
			return
		}

		this.editor.clearGutter("CodeMirror-lsp")
		this.markedDiagnostics.forEach((marker) => {
			marker.clear()
		})
		this.markedDiagnostics = []
		response.diagnostics.forEach((diagnostic: lsp.Diagnostic) => {
			const start = this._lspPositionToDoc(diagnostic.range.start)
			const end = this._lspPositionToDoc(diagnostic.range.end)

			this.markedDiagnostics.push(this.editor.getDoc().markText(start, end, {
				title: diagnostic.message,
				className: "cm-error",
			}))

			const childEl = document.createElement("div")
			childEl.classList.add("CodeMirror-lsp-guttermarker")
			childEl.title = diagnostic.message
			this.editor.setGutterMarker(start.line, "CodeMirror-lsp", childEl)
		})
	}

	public handleSignature(result: lsp.SignatureHelp) {
		this._removeSignatureWidget()
		this._removeTooltip()
		if (!result || !result.signatures.length || !this.token) {
			return
		}

		const htmlElement = document.createElement("div")
		result.signatures.forEach((item: lsp.SignatureInformation) => {
			const el = document.createElement("div")
			el.innerText = item.label
			htmlElement.appendChild(el)
		})
		const coords = this.editor.charCoords(this.token.start, "page")
		this._showTooltip(htmlElement, {
			x: coords.left,
			y: coords.top,
		})
	}

	public handleGoToDef(location: lsp.Location | lsp.Location[] | lsp.LocationLink[] | null) {
		this._removeTooltip()

		if (!location) {
			return
		}

		if (lsp.Location.is(location)) {
			this.onGoToLocation(location)
		} else if(lsp.Location.is(location[0])) {
			this.onGoToLocation(location[0])
		}
	}

	public handleGoTo(location: lsp.Location | lsp.Location[] | lsp.LocationLink[] | null) {
		this._removeTooltip()
		if (!location) {
			return
		}

		let scrollTo: CodeMirror.Position | null = null

		// TODO: improve with multiple document support
		// e.g. notify the owner that a cross-document goto was requested
		if (lsp.Location.is(location)) {
			if (location.uri !== this.document!.uri) {
				return
			}
			this._highlightRanges([location.range])
			scrollTo = this._lspPositionToDoc(location.range.start)
			this.editor.setCursor(scrollTo)
		} else if ((location as any[]).every((l) => lsp.Location.is(l))) {
			const locations = (location as lsp.Location[]).filter((l) => l.uri === this.document!.uri)

			this._highlightRanges(locations.map((l) => l.range))
			scrollTo = this._lspPositionToDoc(locations[0].range.start)
		} else if ((location as any[]).every((l) => lsp.LocationLink.is(l))) {
			const locations = (location as lsp.LocationLink[]).filter((l) => l.targetUri === this.document!.uri)
			this._highlightRanges(locations.map((l) => l.targetRange))
			scrollTo = this._lspPositionToDoc(locations[0].targetRange.start)
		}

		if (scrollTo !== null) {
			this.editor.scrollIntoView(scrollTo)
		}
	}

	public remove() {
		this._removeSignatureWidget()
		this._removeHover()
		this._removeTooltip()
		// Show-hint addon doesn't remove itself. This could remove other uses in the project
		document.querySelectorAll(".CodeMirror-hints").forEach((e) => e.remove())
		this.editor.off("change", this.editorListeners.change)
		this.editor.off("cursorActivity", this.editorListeners.cursorActivity)
		this.editor.off("cursorActivity", this.editorListeners.cursorActivity)
		this.editor.getWrapperElement().removeEventListener("mousemove", this.editorListeners.mouseover)
		this.editor.getWrapperElement().removeEventListener("contextmenu", this.editorListeners.contextmenu)
		Object.keys(this.connectionListeners).forEach((key) => {
			this.connection.off(key as any, this.connectionListeners[key])
		})
		Object.keys(this.documentListeners).forEach((key) => {
			document.removeEventListener(key as any, this.documentListeners[key])
		})
	}

	private _addListeners() {
		const changeListener = debounce(this.handleChange.bind(this), this.options.debounceSuggestionsWhileTyping)
		this.editor.on("change", changeListener)
		this.editorListeners.change = changeListener

		const self = this
		this.connectionListeners = {
			documentSymbol: this.handleDocumentSymbol.bind(self),
			hover: this.handleHover.bind(self),
			highlight: this.handleHighlight.bind(self),
			completion: this.handleCompletion.bind(self),
			signature: this.handleSignature.bind(self),
			diagnostic: this.handleDiagnostic.bind(self),
			goTo: this.handleGoTo.bind(self),
			goToDef: this.handleGoToDef.bind(self)
		}

		Object.keys(this.connectionListeners).forEach((key) => {
			this.connection.on(key as any, this.connectionListeners[key])
		})

		const mouseOverListener = this.handleMouseOver.bind(this)
		this.editor.getWrapperElement().addEventListener("mousemove", mouseOverListener)
		this.editorListeners.mouseover = mouseOverListener

		const debouncedCursor = debounce(() => {
			const pos = this._docPositionToLsp(this.editor.getDoc().getCursor("start"))
			return this.connection.getDocumentHighlights(this.document!.uri, pos)
		}, this.options.quickSuggestionsDelay)

		const rightClickHandler = this._handleRightClick.bind(this)
		this.editor.getWrapperElement().addEventListener("contextmenu", rightClickHandler)
		this.editorListeners.contextmenu = rightClickHandler

		this.editor.on("cursorActivity", debouncedCursor)
		this.editorListeners.cursorActivity = debouncedCursor

		const clickOutsideListener = this._handleClickOutside.bind(this)
		document.addEventListener("click", clickOutsideListener)
		this.documentListeners.clickOutside = clickOutsideListener
	}

	private _getTokenEndingAtPosition(code: string, location: CodeMirror.Position, splitCharacters: string[]): TokenInfo {
		const lines = code.split("\n")
		const line = lines[location.line]
		const typedCharacter = line[location.ch - 1]

		if (splitCharacters.indexOf(typedCharacter) > -1) {
			return {
				text: typedCharacter,
				start: {
					line: location.line,
					ch: location.ch - 1,
				},
				end: location,
			}
		}

		let wordStartChar = 0
		for (let i = location.ch - 1; i >= 0; i--) {
			const char = line[i]
			if (/\W/u.test(char)) {
				break
			}
			wordStartChar = i
		}
		return {
			text: line.substr(wordStartChar, location.ch),
			start: {
				line: location.line,
				ch: wordStartChar,
			},
			end: location,
		}
	}

	private _getFilteredCompletions(
		triggerWord: string,
		items: lsp.CompletionItem[],
	): lsp.CompletionItem[] {
		if (/\W+/.test(triggerWord)) {
			return items
		}
		const word = triggerWord.toLowerCase()
		return items.filter((item: lsp.CompletionItem) => {
			if (item.filterText && item.filterText.toLowerCase().indexOf(word) === 0) {
				return true
			} else {
				return item.label.toLowerCase().indexOf(word) === 0
			}
		}).sort((a: lsp.CompletionItem, b: lsp.CompletionItem) => {
			const inA = (a.label.indexOf(triggerWord) === 0) ? -1 : 1
			const inB = b.label.indexOf(triggerWord) === 0 ? 1 : -1
			return inA + inB
		})
	}

	private _isEventInsideVisible(ev: MouseEvent) {
		// Only handle mouseovers inside CodeMirror's bounding box
		let isInsideSizer = false
		let target: HTMLElement | null = ev.target as HTMLElement
		while (target && target !== document.body) {
			if (target.classList.contains("CodeMirror-sizer")) {
				isInsideSizer = true
				break
			}
			target = target.parentElement
		}

		return isInsideSizer
	}

	private _isEventOnCharacter(ev: MouseEvent) {
		const docPosition: CodeMirror.Position = this.editor.coordsChar({
			left: ev.clientX,
			top: ev.clientY,
		}, "window")

		const token = this.editor.getTokenAt(docPosition)
		const hasToken = !!token.string.length

		return hasToken
	}

	private _handleRightClick(ev: MouseEvent) {
		const docPosition: CodeMirror.Position = this.editor.coordsChar({
			left: ev.clientX,
			top: ev.clientY,
		}, "window")

		const entries: HTMLElement[] = []

		if (this._isEventInsideVisible(ev) && this._isEventOnCharacter(ev)) {
			if (this.connection.isDefinitionSupported()) {
				entries.push(this.definitionContextEntry(docPosition))
			}

			if (this.connection.isTypeDefinitionSupported()) {
				entries.push(this.typeDefinitionContextEntry(docPosition))
			}

			if (this.connection.isReferencesSupported()) {
				entries.push(this.referencesContextEntry(docPosition))
			}

			if (this.connection.isRenameSupported()) {
				entries.push(this.renameContextEntry(docPosition))
			}
		}

		if (entries.length === 0) {
			return
		}

		ev.preventDefault()

		const htmlElement = document.createElement("div")
		htmlElement.classList.add("CodeMirror-lsp-context")

		entries.forEach(htmlElement.appendChild.bind(htmlElement))

		const coords = this.editor.charCoords(docPosition, "page")
		this._showTooltip(htmlElement, {
			x: coords.left,
			y: coords.bottom + this.editor.defaultTextHeight(),
		})

		this.isShowingContextMenu = true
	}

	private definitionContextEntry(docPosition: CodeMirror.Position): HTMLDivElement {
		const goToDefinition = document.createElement("div")
		goToDefinition.innerText = "Go to Definition"
		goToDefinition.addEventListener("click", () => {
			this.connection.getDefinition(this.document!.uri, this._docPositionToLsp(docPosition))
		})
		return goToDefinition
	}

	private typeDefinitionContextEntry(docPosition: CodeMirror.Position): HTMLDivElement {
		const goToTypeDefinition = document.createElement("div")
		goToTypeDefinition.innerText = "Go to Type Definition"
		goToTypeDefinition.addEventListener("click", () => {
			this.connection.getTypeDefinition(this.document!.uri, this._docPositionToLsp(docPosition))
		})
		return goToTypeDefinition
	}

	private referencesContextEntry(docPosition: CodeMirror.Position): HTMLDivElement {
		const getReferences = document.createElement("div")
		getReferences.innerText = "Find all References"
		getReferences.addEventListener("click", () => {
			this.connection.getReferences(this.document!.uri, this._docPositionToLsp(docPosition))
		})
		return getReferences
	}

	private renameContextEntry(docPosition: CodeMirror.Position): HTMLDivElement {
		const renameSymbol = document.createElement("div")
		renameSymbol.innerText = "Rename Symbol"
		renameSymbol.addEventListener("click", () => {
			if (!this.document) { return }

			this.openRenameSymbol({
				textDocument: this.document,
				position: this._docPositionToLsp(docPosition)
			})
		})
		return renameSymbol
	}

	private _handleClickOutside(ev: MouseEvent) {
		if (this.isShowingContextMenu) {
			let target: HTMLElement | null = ev.target as HTMLElement
			while (target && target !== document.body) {
				if (target.classList.contains("CodeMirror-lsp-tooltip")) {
					break
				}
				target = target.parentElement
			}
			this._removeTooltip()
		}
	}

	private _showTooltip(el: HTMLElement, coords: IScreenCoord) {
		if (this.isShowingContextMenu) {
			return
		}

		this._removeTooltip()

		let top = coords.y - this.editor.defaultTextHeight()

		this.tooltip = document.createElement("div")
		this.tooltip.classList.add("CodeMirror-lsp-tooltip")
		this.tooltip.style.left = `${coords.x}px`
		this.tooltip.style.top = `${top}px`
		this.tooltip.appendChild(el)
		document.body.appendChild(this.tooltip)

		// Measure and reposition after rendering first version
		requestAnimationFrame(() => {
			top += this.editor.defaultTextHeight()
			top -= this.tooltip.offsetHeight

			this.tooltip.style.left = `${coords.x}px`
			this.tooltip.style.top = `${top}px`
		})
	}

	private _removeTooltip() {
		if (this.tooltip) {
			this.isShowingContextMenu = false
			this.tooltip.remove()
		}
	}

	private _removeSignatureWidget() {
		if (this.signatureWidget) {
			this.signatureWidget.clear()
			this.signatureWidget = undefined
		}
		if (this.tooltip) {
			this._removeTooltip()
		}
	}

	private _removeHover() {
		if (this.hoverMarker) {
			this.hoverMarker.clear()
			this.hoverMarker = undefined
		}
	}

	private _highlightRanges(items: lsp.Range[]) {
		if (this.highlightMarkers) {
			this.highlightMarkers.forEach((marker) => {
				marker.clear()
			})
		}
		this.highlightMarkers = []
		if (!items.length) {
			return
		}

		items.forEach((item) => {
			const start = this._lspPositionToDoc(item.start)
			const end = this._lspPositionToDoc(item.end)

			this.highlightMarkers.push(this.editor.getDoc().markText(start, end, {
				css: "background-color: rgba(99,99,99,0.5)",
			}))
		})
	}
}
