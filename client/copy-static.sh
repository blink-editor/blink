#!/bin/sh
mkdir -p ./dist/node_modules/codemirror/lib/ \
	./dist/node_modules/codemirror/theme/ \
	./dist/node_modules/codemirror/addon/hint/ \
	./dist/node_modules/bootstrap/dist/css/ \
	./dist/node_modules/bootstrap/dist/js/ \
	./dist/node_modules/jquery/dist/ \
	./dist/node_modules/@fortawesome/fontawesome-free/css/ \
	./dist/node_modules/@fortawesome/fontawesome-free/webfonts/ \
	./dist/vendor/

cp ./src/index.html ./src/codemirror-lsp.css ./src/style.css ./dist
cp ./node_modules/codemirror/lib/codemirror.css ./dist/node_modules/codemirror/lib/codemirror.css
cp ./node_modules/codemirror/theme/monokai.css ./dist/node_modules/codemirror/theme/monokai.css
cp ./node_modules/codemirror/addon/hint/show-hint.css ./dist/node_modules/codemirror/addon/hint/show-hint.css
cp ./node_modules/bootstrap/dist/css/bootstrap.min.css ./dist/node_modules/bootstrap/dist/css/bootstrap.min.css
cp ./node_modules/bootstrap/dist/js/bootstrap.bundle.min.js ./dist/node_modules/bootstrap/dist/js/bootstrap.bundle.min.js
cp ./node_modules/jquery/dist/jquery.min.js ./dist/node_modules/jquery/dist/jquery.min.js
# cp ./node_modules/jquery-easing/dist/jquery.easing.1.3.umd.min.js ./dist/node_modules/jquery-easing/dist/jquery.easing.1.3.umd.min.js
cp ./src/vendor/sb-admin-2.min.js ./dist/vendor/sb-admin-2.min.js
cp ./src/vendor/lib.css ./dist/vendor/lib.css
cp ./node_modules/@fortawesome/fontawesome-free/css/all.min.css ./dist/node_modules/@fortawesome/fontawesome-free/css/all.min.css
cp ./node_modules/@fortawesome/fontawesome-free/webfonts/* ./dist/node_modules/@fortawesome/fontawesome-free/webfonts/
