// All of the Node.js APIs are available in the preload process.
// It has the same sandbox as a Chrome extension.

// Load codemirror
window.CodeMirror = require("codemirror")
require("codemirror/mode/python/python")
