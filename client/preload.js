// All of the Node.js APIs are available in the preload process.
// It has the same sandbox as a Chrome extension.

// Load codemirror
window.CodeMirror = require("codemirror")
require("codemirror/mode/python/python")
require("codemirror/addon/hint/show-hint") // TODO: css?
// TODO: css for adapter?

const {
  LspWsConnection,
  LspTcpConnection,
  CodeMirrorAdapter
} = require("lsp-editor-adapter")

const net = require("net")

window.configureEditorAdapter = function(editor) {
  // Take a look at how the example is configured for ideas
  let connectionOptions = {
    serverUri: 'tcp://localhost:8080/html',
    // The following options are how the language server is configured, and are required
    rootUri: 'file:///Users/bradleywalters/school/cs4000/blink/server/pyls/',
    documentUri: 'file:///Users/bradleywalters/school/cs4000/blink/server/pyls/__main__.py',
    documentText: () => editor.getValue(),
    languageId: 'python',
  };

  // The WebSocket is passed in to allow testability
  // let lspConnection = new LspWsConnection(editor)
  //   .connect(new WebSocket('ws://localhost:8080'));

  let lspConnection = new LspTcpConnection(editor)
    .connect(net.connect(2087, "localhost"));

  // The adapter is what allows the editor to provide UI elements
  let adapter = new CodeMirrorAdapter(lspConnection, {
    // UI-related options go here, allowing you to control the automatic features of the LSP, i.e.
    suggestOnTriggerCharacters: false
  }, editor);

  // You can also provide your own hooks:
  lspConnection.on('error', (e) => {
    console.error(e)
  });

  // You might need to provide your own hooks to handle navigating to another file, for example:
  lspConnection.on('goTo', (locations) => {
    // Do something to handle the URI in this object
  });

  // To clean up the adapter and connection:
  // adapter.remove();
  // lspConnection.close();
}
