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
	ConfigureEditorAdapter: any
	FindCallees: (contents: string) => Thenable<any> // TODO
	FindCallers: (pos: any) => Thenable<any> // TODO
	Reanalyze: () => void
}
