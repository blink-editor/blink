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

		if (functionsCurrentLocation.topLeft == itemName) {
			swapContents(editor, paneRightTop);
			swapContents(editor, paneTopLeft);
			emptyTopPanes()

		} else if (functionsCurrentLocation.topMid == itemName) {
			swapContents(editor, paneRightTop);
			swapContents(editor, paneTopMid);
			emptyTopPanes()
		} else if (functionsCurrentLocation.topRight == itemName) {
			swapContents(editor, paneRightTop);
			swapContents(editor, paneTopRight);
			emptyTopPanes()
		} else {
			// get text from the right function and put that in the main pane
			// editor.setValue(functionsObject[itemName]);
		}

	}
})

function emptyTopPanes() {
			paneTopLeft.setValue("")
			paneTopMid.setValue("")
			paneTopRight.setValue("")
			functionsCurrentLocation.topLeft = ""
			functionsCurrentLocation.topMid = ""
			functionsCurrentLocation.topRight = ""
}

// will use dependency graph
function updateVariables(itemName1, itemName2, str1, str2, str3) {
	functionsCurrentLocation.topLeft = str1
	functionsCurrentLocation.topMid = str2
	functionsCurrentLocation.topRight = str3
	// delete functionsObject[itemName1];
	// will need to be generalized
	// functionsObject[itemName2] = "def main()\n\tfirstFunction()\n\tsecondFunction()\n\tthirdFunction()"
}

paneRightTop.on("mousedown", function() {
	paneTopLeft.setValue("def firstFunction():\n\tprint \"This is your first function\"")
	paneTopMid.setValue("def secondFunction():\n\tprint \"This is your second function\"")
	paneTopRight.setValue("def thirdFunction():\n\tprint \"This is your third function\"")
	editor.setValue("def main()\n\tfirstFunction()\n\tsecondFunction()\n\tthirdFunction()")
	paneRightTop.setValue("");
	// should abstract into updateVariables
	functionsCurrentLocation.topLeft = "firstFunction";
	functionsCurrentLocation.topMid = "secondFunction";
	functionsCurrentLocation.topRight = "thirdFunction";

})

paneTopLeft.on("mousedown", function() {
	if (paneTopLeft.getValue() != "") {
		swapContents(editor, paneRightTop);
		swapContents(editor, paneTopLeft);
		emptyTopPanes()
	}
})

paneTopMid.on("mousedown", function() {
	if (paneTopLeft.getValue() != "") {
		swapContents(editor, paneRightTop);
		swapContents(editor, paneTopMid);
		emptyTopPanes()
	}
})

paneTopRight.on("mousedown", function() {
	if (paneTopLeft.getValue() != "") {
		swapContents(editor, paneRightTop);
		swapContents(editor, paneTopRight);
		emptyTopPanes()
	}
})
