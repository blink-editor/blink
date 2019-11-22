// This file is required by the index.html file and will
// be executed in the renderer process for that window.
// No Node.js APIs are available in this process because
// `nodeIntegration` is turned off. Use `preload.js` to
// selectively enable features needed in the rendering
// process.

import * as lsp from "vscode-languageserver-protocol"

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

`

let activeFunctionName = "main"

let calleesOfActive: lsp.SymbolInformation[] = [
	{ name: "firstFunction", kind: 1, location: { uri: "file:///untitled", range: { start: { line: 0, character: 0 }, end: { line: 2, character: 0 } } } },
	{ name: "secondFunction", kind: 1, location: { uri: "file:///untitled", range: { start: { line: 4, character: 0 }, end: { line: 6, character: 0 } } } },
	{ name: "thirdFunction", kind: 1, location: { uri: "file:///untitled", range: { start: { line: 8, character: 0 }, end: { line: 10, character: 0 } } } },
]

let callersOfActive: lsp.SymbolInformation[] = []

const extractRangeOfFile = (range: lsp.Range): string => {
	return `def firstFunction():
	print("first")

	` // TODO(urgent)
}

const swapToSymbol = (symbol: lsp.SymbolInformation) => {
	activeFunctionName = newSymbol.name

	const contents = extractRangeOfFile(newSymbol.range)
	calleesOfActive = navObject.findCallees(contents)

	callersOfActive = navObject.findCallers({
		textDocument: { uri: "file:///untitled" },
		position: { line: newSymbol.range.start.line, character: 5 }, // TODO: not hardcode
	})

	// TODO: populate panes
}

const swapToCallee = (index: number) => {
	if (index >= calleesOfActive.length) {
		return
	}

	swapToSymbol(calleesOfActive[index])
}

const swapToCaller = (index) => {
	if (index >= callersOfActive.length) {
		return
	}

	swapToSymbol(callersOfActive[index])
}

// TODO: use better polyfill
;(window as any).setImmediate = function(callback: (...args: any[]) => void) {
	window.setTimeout(callback, 0)
}

let editor

setTimeout(() => {
	console.log("connecting to server")
	;(window as any).ConfigureEditorAdapter(editor)
}, 5000) // TODO



// this is for demonstration, but dependency graph will replace
let functionsObject = {
	"firstFunction": "def firstFunction():\n\tprint \"This is your first function\"",
	"secondFunction": "def secondFunction():\n\tprint \"This is your second function\"",
	"thirdFunction": "def thirdFunction():\n\tprint \"This is your third function\""
}

// Keep track of what function is in what pane
let functionsCurrentLocation = {
	topLeft: "firstFunction",
	topMid: "secondFunction",
	topRight: "thirdFunction",
	rightTop: "",
	rightMid: "",
	rightBottom: ""
}


function addToFunctions(functionName, functionText) {
	functionsObject[functionName] = functionText;
}


const paneTopLeft = CodeMirror(document.getElementById('top-left-pane'), {
	mode: "python",
	lineNumbers: true,
	theme: "monokai",
	readOnly: "nocursor",
	value: "def firstFunction():\n\tprint \"This is your first function\"",
	lineWrapping: true
})


paneTopLeft.setSize("100%", "200px")

const paneTopMid = CodeMirror(document.getElementById('top-mid-pane'), {
	mode: "python",
	lineNumbers: true,
	theme: "monokai",
	readOnly: "nocursor",
	value: "def secondFunction():\n\tprint \"This is your second function\"",
	lineWrapping: true
})

paneTopMid.setSize("100%", "200px")

const paneTopRight = CodeMirror(document.getElementById('top-right-pane'), {
	mode: "python",
	lineNumbers: true,
	theme: "monokai",
	readOnly: "nocursor",
	value: "def thirdFunction():\n\tprint \"This is your third function\"",
	lineWrapping: true
})

paneTopRight.setSize("100%", "200px")

const paneRightTop = CodeMirror(document.getElementById('side-top-pane'), {
	mode: "python",
	lineNumbers: true,
	theme: "monokai",
	readOnly: "nocursor"
})
paneRightTop.setSize("100%", "200px")

const paneRightMid = CodeMirror(document.getElementById('side-mid-pane'), {
	mode: "python",
	lineNumbers: true,
	theme: "monokai",
	readOnly: "nocursor"
})
paneRightMid.setSize("100%", "200px")



const paneRightBottom = CodeMirror(document.getElementById('side-bottom-pane'), {
	mode: "python",
	lineNumbers: true,
	theme: "monokai",
	readOnly: "nocursor"
})
paneRightBottom.setSize("100%", "201px")

editor = CodeMirror(document.getElementById('main-pane'), {
	mode: "python",
	lineNumbers: true,
	theme: "monokai",
	gutters: ["CodeMirror-linenumbers", "CodeMirror-lsp"],
	value: "def main()\n\tfirstFunction()\n\tsecondFunction()\n\tthirdFunction()"
})

editor.setSize("100%", "46.35em")
// editor.setSize("100%", "100%")

function swapContents(pane1, pane2) {
	// var paneTemp = pane2;
	// pane1.setValue(pane2.getValue());
	let paneTemp = pane2.getValue();
	pane2.setValue(pane1.getValue());
	pane1.setValue(paneTemp);
}

// This will need to use the dependency graph to not be hard coded
editor.on("dblclick", function() {
	let from = editor.getCursor("from");
	let lineNo =  from.line;
	let chFrom = from.ch;
	let chTo = editor.getCursor("to").ch;
	let lineText = editor.getLine(lineNo);


	let itemName = lineText.slice(chFrom, chTo);

	if (itemName in functionsObject) {
		// This will need to use the dependency graph to not be hard coded

		// TODO
		// if (functionsCurrentLocation.topLeft == itemName) {
		// 	swapContents(editor, paneRightTop);
		// 	swapContents(editor, paneTopLeft);
		// 	emptyTopPanes()

		// } else if (functionsCurrentLocation.topMid == itemName) {
		// 	swapContents(editor, paneRightTop);
		// 	swapContents(editor, paneTopMid);
		// 	emptyTopPanes()
		// } else if (functionsCurrentLocation.topRight == itemName) {
		// 	swapContents(editor, paneRightTop);
		// 	swapContents(editor, paneTopRight);
		// 	emptyTopPanes()
		// } else {
		// 	// get text from the right function and put that in the main pane
		// 	// editor.setValue(functionsObject[itemName]);
		// }

	}
})

paneTopLeft.on("mousedown", function() {
	if (paneTopLeft.getValue() != "") {
		swapToCallee(0)
	}
})

paneTopMid.on("mousedown", function() {
	if (paneTopLeft.getValue() != "") {
		swapToCallee(1)
	}
})

paneTopRight.on("mousedown", function() {
	if (paneTopLeft.getValue() != "") {
		swapToCallee(2)
	}
})

paneRightTop.on("mousedown", () => {
	if (paneRightTop.getValue() !== "") {
		swapToCaller(0)
	}
})

paneRightMid.on("mousedown", () => {
	if (paneRightMid.getValue() !== "") {
		swapToCaller(1)
	}
})

paneRightBottom.on("mousedown", () => {
	if (paneRightBottom.getValue() !== "") {
		swapToCaller(2)
	}
})
