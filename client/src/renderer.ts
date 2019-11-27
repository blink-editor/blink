// This file is required by the index.html file and will
// be executed in the renderer process for that window.
// No Node.js APIs are available in this process because
// `nodeIntegration` is turned off. Use `preload.js` to
// selectively enable features needed in the rendering
// process.

let file = `def firstFunction():
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
	const allLines = file.split("\n")
	const lines = allLines.slice(range.start.line, range.end.line)
	// extract only from first included character of first line
	if (lines.length > 0) {
		lines[0] = lines[0].slice(range.start.character, undefined)
	}
	// extract only up to last included character of last line
	if (range.end.line < allLines.length) {
		lines.push(allLines[range.end.line].slice(undefined, range.end.character))
	}
	return lines.join("\n")
}

const applyFileChange = (change) => {
	const startString = extractRangeOfFile({ start: { line: 0, character: 0, }, end: change.range.start })
	const endString = extractRangeOfFile({ start: change.range.end, end: { line: file.split("\n").length + 1, character: 0 } })
	file = startString + change.text + endString
	return file
}

// TODO: use better polyfill
;(window as any).setImmediate = function(callback: (...args: any[]) => void) {
	window.setTimeout(callback, 0)
}

class Editor {
	calleePanes: [CodeMirror.Editor, CodeMirror.Editor, CodeMirror.Editor]
	callerPanes: [CodeMirror.Editor, CodeMirror.Editor, CodeMirror.Editor]

	activeEditorPane: CodeMirror.Editor

	activeSymbol: any | null = null
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
			;(window as any).ConfigureEditorAdapter(
				this.activeEditorPane,
				file,
				(text) => {
					const oldLines = file.split("\n").length
					file = applyFileChange({
						range: this.activeSymbol?.location.range,
						text: text
					})
					const newLines = file.split("\n").length
					if (oldLines !== newLines) {
						// TODO: maybe fire off document symbol request
						// setTimeout(() => {
						// 	;(window as any).reanalyze()
						// }, 1000)
						this.activeSymbol.location.range.end.line += (newLines - oldLines)
					}
					return file
				},
				() => this.activeSymbol?.location.range.start.line ?? 0,
				(main) => {
					if (main) {
						console.log("reanalyzed and obtained new main symbol", main)
						this.swapToSymbol(main)
					} else {
						console.error("no main detected")
					}
				}
			)

			// kick off reanalysis to find main initially
			setTimeout(() => {
				;(window as any).Reanalyze()
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
				this.activeSymbol = symbol

				// new callers/callees are fetched ones
				this.calleesOfActive = callees
				this.callersOfActive = callers

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
