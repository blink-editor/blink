// NOTES:
// encode/decode strings in dictionaries -- rather use tuples, but idk how yet
// nesting is determined by lines -- this can likely be improved, what if same line?
// bradley mentioned a better data structure to store ranges -- what is it and will it actually be noticably faster?
// findCallees will fail if two symbols are the same (in different locations/URIs). this is because completion requests don't return symbol locations
/*
interface richSymbol {
    name: string;
    kind: number; // whatever enum is used by LSP
    uri: string;  // documentUri
}
*/
var navObject = {
    symToDefRange: {},
    //defRangeToSym: {},
    concatChar: "\"",
    testMap: new Map(),
    // encode an array of items into a string key
    encodeKey: function (...items) {
        let result = "";
        for (let item of items) {
            result = result.concat(item, this.concatChar);
        }
        return result.substr(0, result.length - 1);
    },
    // decode a string key into an array of strings
    decodeKey(key) {
        return key.split(this.concatChar);
    },
    // rebuilds symToDefRange and defRangeToSym.
    // Call on file load, return, save.
    rebuildMaps: function () {
        this.symToDefRange = {};
        this.defRangeToSym = {};
        // request textDocument/documentSymbol, receive SymbolInformation[]
        var result = [
            { name: "class1", kind: 1, location: { uri: "file://file1", range: { start: { line: 0, character: 0 }, end: { line: 10, character: 0 } } } },
            { name: "func1", kind: 2, location: { uri: "file://file1", range: { start: { line: 4, character: 0 }, end: { line: 9, character: 10 } } } }
        ];
        for (let docSym of result) {
            let symKey = this.encodeKey(docSym.name, docSym.kind, docSym.location.uri);
            //let defRangeKey = this.encodeKey(docSym.location.range.start.line, docSym.location.range.start.character, docSym.location.range.end.line, docSym.location.range.end.character);
            //let sym: richSymbol = { name: docSym.name, kind: docSym.kind, uri: docSym.location.uri };
            this.symToDefRange[symKey] = docSym.location.range;
            //this.defRangeToSym[defRangeKey] = sym;
        }
    },
    findCallers: function (symPos) {
        var output = [];
        // request textDocument/references, receive Location[]
        var result = [
            { uri: "file://file1", range: { start: { line: 1, character: 4 }, end: { line: 1, character: 10 } } },
            { uri: "file://file1", range: { start: { line: 20, character: 4 }, end: { line: 20, character: 11 } } },
            { uri: "file://file1", range: { start: { line: 6, character: 4 }, end: { line: 6, character: 12 } } }
        ];
        // for each reference recieved, find parent scope
        for (let currRef of result) {
            var bestScore = null;
            var bestKey = null;
            // search for tightest enclosing scope for this reference
            for (let key in this.symToDefRange) {
                let currRange = this.symToDefRange[key];
                // if currRange within refRange and holds a tighter line bound than best
                if (currRange.start.line <= currRef.range.start.line && currRange.end.line >= currRef.range.end.line
                    && (currRange.end.line - currRange.start.line < bestScore || bestScore === null)) {
                    bestScore = currRange.end.line - currRange.start.line;
                    bestKey = key;
                }
            }
            // if no parents to caller, was called from global scope, so skip it, otherwise
            if (bestKey !== null) {
                console.log(bestKey);
                output.push(this.symToDefRange[bestKey]);
            }
        }
        return output;
    },
    findCallees: function () {
        // assuming the function is in its own pseudo-file
        var output = [];
        // request textDocument/completion with cursor at empty location, receive completionItem[]
        var acceptableSyms = [1, 2]; // add whatever we want
        var result = [
            { label: "class1", kind: 1 },
            { label: "func1", kind: 2 },
            { label: "var1", kind: 3 },
        ];
        // for each completion received, find matching location
        for (let completion of result) {
            if (acceptableSyms.indexOf(completion.kind) >= 0) {
                // check completion against each known symbol
                for (let key in this.symToDefRange) {
                    let decodedKey = this.decodeKey(key);
                    if (completion.label === decodedKey[0] && completion.kind === +decodedKey[1]) {
                        console.log(key);
                        output.push(this.symToDefRange[key]);
                        break;
                    }
                }
            }
        }
        return output;
    }
};
navObject.rebuildMaps();
console.log(navObject.findCallers({ line: 0, character: 10 }));
console.log(navObject.findCallees());
//# sourceMappingURL=nav-object.js.map