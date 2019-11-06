// This file is required by the index.html file and will
// be executed in the renderer process for that window.
// All of the Node.js APIs are available in this process.

const editor = CodeMirror(document.body, {
  mode: "python",
  lineNumbers: true,
  theme: "monokai"
})

setTimeout(() => {
	console.log("configuring editor")
	configureEditorAdapter(editor)
}, 5000) // TODO
