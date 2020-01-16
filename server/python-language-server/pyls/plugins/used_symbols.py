# Copyright 2017 Palantir Technologies, Inc.
import logging
from pyls import hookimpl, uris
from pyls.lsp import CompletionItemKind, SymbolKind

from pprint import pformat
log = logging.getLogger(__name__)

@hookimpl
def pyls_used_document_symbols(config, document):
    all_scopes = config.plugin_settings('jedi_symbols').get('all_scopes', True)
    references = document.jedi_names(all_scopes=all_scopes, definitions=False, references=True)

    out = []

    for ref in references:
        if not _include_ref(ref): continue

        # log.debug(f"{pformat(ref._name)}, {pformat(dir(ref._name))}, {pformat(vars(ref._name))}")
        # log.debug(f"{pformat(ref._name.tree_name)}")
        # log.debug(f"{pformat(ref._name.tree_name.start_pos)}")
        # log.debug(f"{pformat(ref._name.tree_name.end_pos)}")
        # log.debug(f"{pformat(ref._name.tree_name.parent)}")

        definitions = ref.goto_assignments()
        first_def = definitions[0] if (len(definitions) > 0) else None

        def_type = first_def.type if first_def else None
        def_module = first_def.module_name if first_def else None
        def_range = None

        try:
            def_range = _def_range(first_def) if first_def else None
        except:
            # TODO: fix this
            log.debug(f"{pformat(ref._name)}, {pformat(dir(ref._name))}, {pformat(vars(ref._name))}")
            log.debug(f"{pformat(ref._name.tree_name)}")
            log.debug(f"{pformat(ref._name.tree_name.start_pos)}")
            log.debug(f"{pformat(ref._name.tree_name.end_pos)}")
            log.debug(f"{pformat(ref._name.tree_name.parent)}")
            continue

        def_uri = uris.uri_with(document.uri, path=first_def.module_path) if first_def else None

        out.append({
            'name': first_def.name if first_def else ref.name,
            'containerName': _container(first_def),
            'location': {
                'uri': def_uri,
                'range': def_range,
            },
            'kind': _SYMBOL_KIND_MAP.get(def_type),
            'rayBensModule': def_module,
            # TODO: rayBensUsageLocation instead?
            'rayBensUsageRange': _ref_range(ref),
        })

    return out


def _container(definition):
    try:
        # Jedi sometimes fails here.
        parent = definition.parent()
        # Here we check that a grand-parent exists to avoid declaring symbols
        # as children of the module.
        if parent.parent():
            return parent.name
    except:  # pylint: disable=bare-except
        return None

    return None


def _def_range(definition):
    # This gets us more accurate end position
    definition = definition._name.tree_name.get_definition()
    (start_line, start_column) = definition.start_pos
    (end_line, end_column) = definition.end_pos
    return {
        'start': {'line': start_line - 1, 'character': start_column},
        'end': {'line': end_line - 1, 'character': end_column}
    }


def _ref_range(reference):
    (start_line, start_column) = reference._name.tree_name.start_pos
    (end_line, end_column) = reference._name.tree_name.end_pos
    return {
        'start': {'line': start_line - 1, 'character': start_column},
        'end': {'line': end_line - 1, 'character': end_column}
    }


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

_SYMBOL_KIND_MAP = {
    'none': SymbolKind.Variable,
    'type': SymbolKind.Class,
    'tuple': SymbolKind.Class,
    'dict': SymbolKind.Class,
    'dictionary': SymbolKind.Class,
    'function': SymbolKind.Function,
    'lambda': SymbolKind.Function,
    'generator': SymbolKind.Function,
    'class': SymbolKind.Class,
    'instance': SymbolKind.Class,
    'method': SymbolKind.Method,
    'builtin': SymbolKind.Class,
    'builtinfunction': SymbolKind.Function,
    'module': SymbolKind.Module,
    'file': SymbolKind.File,
    'xrange': SymbolKind.Array,
    'slice': SymbolKind.Class,
    'traceback': SymbolKind.Class,
    'frame': SymbolKind.Class,
    'buffer': SymbolKind.Array,
    'dictproxy': SymbolKind.Class,
    'funcdef': SymbolKind.Function,
    'property': SymbolKind.Property,
    'import': SymbolKind.Module,
    'keyword': SymbolKind.Variable,
    'constant': SymbolKind.Constant,
    'variable': SymbolKind.Variable,
    'value': SymbolKind.Variable,
    'param': SymbolKind.Variable,
    'statement': SymbolKind.Variable,
    'boolean': SymbolKind.Boolean,
    'int': SymbolKind.Number,
    'longlean': SymbolKind.Number,
    'float': SymbolKind.Number,
    'complex': SymbolKind.Number,
    'string': SymbolKind.String,
    'unicode': SymbolKind.String,
    'list': SymbolKind.Array,
}
