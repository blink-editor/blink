mkdir -p ./dist/node_modules/codemirror/lib/ ./dist/node_modules/codemirror/theme/ ./dist/node_modules/codemirror/addon/hint/
cp ./src/index.html ./src/codemirror-lsp.css ./dist
cp ./node_modules/codemirror/lib/codemirror.css ./dist/node_modules/codemirror/lib/codemirror.css
cp ./node_modules/codemirror/theme/monokai.css ./dist/node_modules/codemirror/theme/monokai.css
cp ./node_modules/codemirror/addon/hint/show-hint.css ./dist/node_modules/codemirror/addon/hint/show-hint.css

