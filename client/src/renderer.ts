// This file is required by the index.html file and will
// be executed in the renderer process for that window.
// No Node.js APIs are available in this process because
// `nodeIntegration` is turned off. Use `preload.js` to
// selectively enable features needed in the rendering
// process.

const file = `def firstFunction():
	print("first")


def secondFunction():
	print("second")


def thirdFunction():
	print("third")


def main():
	firstFunction()
	secondFunction()
	thirdFunction()


def test():
	main()

`

const extractRangeOfFile = (range): string => {
	const lines = file.split("\n").slice(range.start.line, range.end.line)
	// if (lines.length > 0) {
	// 	lines[0] = lines[0].slice(range.start.character)
	// 	lines[lines.length - 1] = lines[lines.length - 1].slice(null, range.end.character)
	// }
	return lines.join("\n")
}

// TODO: use better polyfill
;(window as any).setImmediate = function(callback: (...args: any[]) => void) {
	window.setTimeout(callback, 0)
}

class Editor {
	calleePanes: [CodeMirror.Editor, CodeMirror.Editor, CodeMirror.Editor]
	callerPanes: [CodeMirror.Editor, CodeMirror.Editor, CodeMirror.Editor]

	activeEditorPane: CodeMirror.Editor

	activeFunctionName: string | null = null
	calleesOfActive: any[] = []
	callersOfActive: any[] = []

	constructor() {
		// creates a CodeMirror editor configured to look like a preview pane
		const createPane = function(id, wrapping) {
			const pane = (window as any).CodeMirror(document.getElementById(id), {
				mode: "python",
				lineNumbers: true,
				theme: "monokai",
				readOnly: "nocursor",
				lineWrapping: wrapping
			})

			pane.setSize("100%", "200px")

			return pane
		}

		// create callee preview panes (top)
		this.calleePanes = [
			createPane("top-left-pane", true),
			createPane("top-mid-pane", true),
			createPane("top-right-pane", true),
		]

		// create caller preview panes (side)
		this.callerPanes = [
			createPane("side-top-pane", false),
			createPane("side-mid-pane", false),
			createPane("side-bottom-pane", false),
		]

		// configure click handlers for switching to panes
		this.calleePanes.forEach((pane, index) => {
			pane.on("mousedown", () => {
				if (pane.getValue() !== "") {
					this.swapToCallee(index)
				}
			})
		})
		this.callerPanes.forEach((pane, index) => {
			pane.on("mousedown", () => {
				if (pane.getValue() !== "") {
					this.swapToCaller(index)
				}
			})
		})

		// create active editor pane
		this.activeEditorPane = (window as any).CodeMirror(document.getElementById("main-pane"), {
			mode: "python",
			lineNumbers: true,
			theme: "monokai",
			gutters: ["CodeMirror-linenumbers", "CodeMirror-lsp"]
		})
		this.activeEditorPane.setSize("100%", "46.35em")

		// in 5 seconds, attempt to connect the active editor to the language server
		setTimeout(() => {
			console.log("connecting to server")
			;(window as any).ConfigureEditorAdapter(this.activeEditorPane, file)

			// initially select main once done
			setTimeout(() => {
				;(window as any).FindMain()
					.then((main) => {
						if (main) {
							this.swapToSymbol(main)
						} else {
							console.error("no main detected")
						}
					})
			}, 5000) // TODO
		}, 5000) // TODO
	}

	swapToCallee(index) {
		if (index >= this.calleesOfActive.length) {
			return
		}

		this.swapToSymbol(this.calleesOfActive[index])
	}

	swapToCaller(index) {
		if (index >= this.callersOfActive.length) {
			return
		}

		this.swapToSymbol(this.callersOfActive[index])
	}

	swapToSymbol(symbol) {
		console.log("BEFORE:", this.activeFunctionName)
		console.log("BEFORE:", this.calleesOfActive)
		console.log("BEFORE:", this.callersOfActive)

		// fetch new callees
		const contents = extractRangeOfFile(symbol.location.range)
		const callees = (window as any).FindCallees(contents)

		// fetch new callers
		const callers = (window as any).FindCallers({
			textDocument: { uri: symbol.location.uri },
			position: { line: symbol.location.range.start.line, character: 5 }, // TODO: not hardcode
		})

		// don't update any panes / props until done
		Promise.all([callees, callers])
			.then(([callees, callers]) => {
				// newly active function is switched to
				this.activeFunctionName = symbol.name

				// new callers/callees are fetched ones
				this.calleesOfActive = callees
				this.callersOfActive = callers

				console.log("AFTER:", this.activeFunctionName)
				console.log("AFTER:", this.calleesOfActive)
				console.log("AFTER:", this.callersOfActive)

				// populate panes
				this.activeEditorPane.setValue(contents)
				this.calleePanes.forEach((pane) => pane.setValue(""))
				callees.slice(null, 3).forEach((calleeSym, index) => {
					this.calleePanes[index].setValue(extractRangeOfFile(calleeSym.location.range))
				})
				this.callerPanes.forEach((pane) => pane.setValue(""))
				callers.slice(null, 3).forEach((callerSym, index) => {
					this.callerPanes[index].setValue(extractRangeOfFile(callerSym.location.range))
				})
			})
	}
}

const editor = new Editor()
