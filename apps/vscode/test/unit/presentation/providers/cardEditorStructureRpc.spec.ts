import * as vscode from 'vscode';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CardEditorRpc,
  type CardCustomEditorDependencies,
} from '@/presentation/providers/CardCustomEditorProvider';
import { VirtualDocumentStore } from '@/presentation/providers/virtualDocumentStore';

const sceneCardText: string = ['type: scene', 'id: 01-first', 'summary: 첫 방송을 앞둔 밤', ''].join('\n');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('card editor scene structure rpc', () => {
  it('charges the structure proposal to the workspace, not the scene file', async () => {
    const workspaceRoot: vscode.Uri = vscode.Uri.file('/ws');
    vi.spyOn(vscode.workspace, 'getWorkspaceFolder').mockReturnValue({
      uri: workspaceRoot,
      name: 'ws',
      index: 0,
    } as vscode.WorkspaceFolder);
    const proposeSceneStructure = vi.fn(async () => ({}));
    const createService = vi.fn(() => ({ proposeSceneStructure }));
    const document = {
      uri: vscode.Uri.file('/ws/scene/01-first.card'),
      getText: (): string => sceneCardText,
    } as unknown as vscode.TextDocument;
    const dependencies = {
      aiGateway: { createService, getTaskProvider: () => 'mock' },
    } as unknown as CardCustomEditorDependencies;

    const rpc: CardEditorRpc = new CardEditorRpc(document, dependencies, new VirtualDocumentStore());
    await rpc.handlers()['cards.structureScene']({ uri: 'file:///ws/scene/01-first.card' });

    expect(proposeSceneStructure).toHaveBeenCalledTimes(1);
    expect(createService).toHaveBeenCalledWith(workspaceRoot);
  });
});
