interface GlobalEvents {
	on(event: string, callback: any)
	once(event: string, callback: any)
	emit(event: string)
}

interface Globals {
	CodeMirror: any // TODO

	// events
	events: GlobalEvents
	serverConnected?: boolean
	clientInitialized?: boolean

	// helper functions
	TryStartingServer: () => void
	ConfigureEditorAdapter: (params: ConfigureEditorAdapterParams) => void
	FindCallees: (symbol: any) => Thenable<any> // TODO
	FindCallers: (pos: any) => Thenable<any> // TODO
	ChangeOwnedFile: (uri: string, contents: string) => void
	AnalyzeUri: (uri: string, contents: string) => Thenable<any>
}

interface ConfigureEditorAdapterParams {
	editor: any
	onChange: (editorText: string) => string
	getLineOffset: () => number
	onShouldSwap: (symbol: any) => void
}
