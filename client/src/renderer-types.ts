interface GlobalEvents {
	on(event: string, callback: any)
	once(event: string, callback: any)
	emit(event: string)
}

interface Globals {
	CodeMirror: any // TODO
	app: any 
	
	// events
	events: GlobalEvents
	serverConnected?: boolean
	clientInitialized?: boolean

	// helper functions
	TryStartingServer: () => void
	ConfigureEditorAdapter: (params: ConfigureEditorAdapterParams) => void
	FindCallees: (symbol: any) => Thenable<any> // TODO
	FindCallers: (pos: any) => Thenable<any> // TODO
	Reanalyze: () => void
	ChangeFileAndReanalyze: (text: string) => void

	// demo
	OpenSampleFile: () => Thenable<string | null>
}

interface ConfigureEditorAdapterParams {
	editor: any
	initialFileText: string
	onChange: (editorText: string) => string
	getLineOffset: () => number
	onReanalyze: (navObject: any) => void
	onShouldSwap: (symbol: any) => void
}
