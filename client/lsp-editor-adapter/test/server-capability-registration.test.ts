import * as expect from 'expect';
import { Registration, ServerCapabilities, Unregistration } from 'vscode-languageserver-protocol';
import { registerServerCapability, unregisterServerCapability } from '../src/server-capability-registration';

describe('ServerCapabilities client registration', () => {
  const serverCapabilities = {
    hoverProvider: true,
    completionProvider: {
      resolveProvider: true,
      triggerCharacters: ['.', ','],
    },
    signatureHelpProvider: {
      triggerCharacters: ['.', ','],
    },
    definitionProvider: true,
    typeDefinitionProvider: true,
    implementationProvider: true,
    referencesProvider: true,
    documentHighlightProvider: true,
    documentSymbolProvider: true,
    workspaceSymbolProvider: true,
    codeActionProvider: true,
    codeLensProvider: {
      resolveProvider: true,
    },
    documentFormattingProvider: true,
    documentRangeFormattingProvider: true,
    documentOnTypeFormattingProvider: {
      firstTriggerCharacter: '.',
    },
    renameProvider: true,
    documentLinkProvider: {
      resolveProvider: true,
    },
    colorProvider: true,
    foldingRangeProvider: true,
    declarationProvider: true,
    executeCommandProvider: {
      commands: ['not', 'real', 'commands'],
    },
  };

  it('registers server capabilities', () => {
    Object.keys(serverCapabilities).forEach((capability) => {
      // @ts-ignore
      const capabilityOptions = serverCapabilities[capability];
      const registration = { id: 'id', method: getMethodFromCapability(capability) } as Registration;

      if (typeof capabilityOptions !== 'boolean') {
        registration.registerOptions = capabilityOptions;
      }

      const newServerCapabilities = registerServerCapability({} as ServerCapabilities, registration);

      if (typeof capabilityOptions === 'boolean') {
        // @ts-ignore
        expect(newServerCapabilities[capability]).toBe(capabilityOptions);
      } else {
        // @ts-ignore
        expect(newServerCapabilities[capability]).toMatchObject(capabilityOptions);
      }
    });
  });

  it('unregisters server capabilities', () => {
    Object.keys(serverCapabilities).forEach((capability) => {
      const unregistration = { id: 'some id', method: getMethodFromCapability(capability) } as Unregistration;
      const newServerCapabilities = unregisterServerCapability(serverCapabilities, unregistration);
      // @ts-ignore
      expect(newServerCapabilities[capability]).toBeUndefined();
    });
  });
});

function getMethodFromCapability(capability: string): string {
  return `textDocument/${capability.split('Provider')[0]}`;
}
