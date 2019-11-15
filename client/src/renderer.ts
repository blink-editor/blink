// This file is required by the index.html file and will
// be executed in the renderer process for that window.
// No Node.js APIs are available in this process because
// `nodeIntegration` is turned off. Use `preload.js` to
// selectively enable features needed in the rendering
// process.

// TODO: use better polyfill
;(window as any).setImmediate = function(callback: (...args: any[]) => void) {
	window.setTimeout(callback, 0)
}

const editor = (window as any).CodeMirror.fromTextArea(document.querySelector("textarea"), {
	mode: "python",
	lineNumbers: true,
	theme: "monokai",
	gutters: ["CodeMirror-linenumbers", "CodeMirror-lsp"]
})

setTimeout(() => {
	console.log("connecting to server")
	;(window as any).ConfigureEditorAdapter(editor)
}, 5000) // TODO
