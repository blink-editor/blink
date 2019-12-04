# Copyright 2017 Palantir Technologies, Inc.
import logging
from pyls import hookimpl
from pyls.lsp import CompletionItemKind

log = logging.getLogger(__name__)

@hookimpl
def pyls_used_document_symbols(config, document):
    all_scopes = config.plugin_settings('jedi_symbols').get('all_scopes', True)
    references = document.jedi_names(all_scopes=all_scopes, definitions=False, references=True)
    log.debug(f"big boy big boy ${repr(references)}")

    return [{
        'label': d.name,
        'kind': _TYPE_MAP.get(d.type),
        'detail': None,
        'documentation': None,
        'sortText': None,
        'insertText': None
    } for d in references if _include_ref(d)]


def _include_ref(reference):
    return (
        # Don't tend to include parameters as symbols
        reference.type != 'param' and
        # Unused vars should also be skipped
        reference.name != '_' and
        _TYPE_MAP.get(reference.type) is not None
    )


# Map to the VSCode type
_TYPE_MAP = {
    'none': CompletionItemKind.Value,
    'type': CompletionItemKind.Class,
    'tuple': CompletionItemKind.Class,
    'dict': CompletionItemKind.Class,
    'dictionary': CompletionItemKind.Class,
    'function': CompletionItemKind.Function,
    'lambda': CompletionItemKind.Function,
    'generator': CompletionItemKind.Function,
    'class': CompletionItemKind.Class,
    'instance': CompletionItemKind.Reference,
    'method': CompletionItemKind.Method,
    'builtin': CompletionItemKind.Class,
    'builtinfunction': CompletionItemKind.Function,
    'module': CompletionItemKind.Module,
    'file': CompletionItemKind.File,
    'xrange': CompletionItemKind.Class,
    'slice': CompletionItemKind.Class,
    'traceback': CompletionItemKind.Class,
    'frame': CompletionItemKind.Class,
    'buffer': CompletionItemKind.Class,
    'dictproxy': CompletionItemKind.Class,
    'funcdef': CompletionItemKind.Function,
    'property': CompletionItemKind.Property,
    'import': CompletionItemKind.Module,
    'keyword': CompletionItemKind.Keyword,
    'constant': CompletionItemKind.Variable,
    'variable': CompletionItemKind.Variable,
    'value': CompletionItemKind.Value,
    'param': CompletionItemKind.Variable,
    'statement': CompletionItemKind.Variable,
}
