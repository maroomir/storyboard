import * as vscode from 'vscode';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DraftHistoryArchiver, type HostAdapters } from '@storyboard/story-engine';
import { vscodeFileSystem } from '@/infrastructure/vscode/vscodeFileSystem';
import { CondenseDraftCommand } from '@/presentation/commands/condenseDraftCommand';
import { VirtualDocumentStore } from '@/presentation/providers/virtualDocumentStore';

const workspaceFolder: vscode.WorkspaceFolder = {
  uri: vscode.Uri.file('/workspace'),
  name: 'workspace',
  index: 0,
} as vscode.WorkspaceFolder;

function draftText(body: string): string {
  return [
    '---',
    'sceneStem: 01-intro',
    'format: novel',
    'generatedAt: "2026-08-06T09:00:00.000Z"',
    '---',
    body,
  ].join('\n');
}

const openedDraftText: string = draftText('열린 사본의 본문입니다. 아주 길게 이어집니다.');
const sceneStemDraftText: string = draftText('머리말 이름의 다른 초안입니다.');

let files: Map<string, string>;

function createOpenedEditor(uri: vscode.Uri, text: string): unknown {
  return {
    document: {
      uri,
      getText: (): string => text,
      positionAt: (offset: number): vscode.Position => new vscode.Position(0, offset),
      save: async (): Promise<boolean> => true,
    },
  };
}

function useInMemoryFiles(): void {
  vi.spyOn(vscode.workspace.fs, 'readFile').mockImplementation(async (uri) => {
    const content: string | undefined = files.get(uri.fsPath);
    if (content === undefined) {
      throw new Error(`missing ${uri.fsPath}`);
    }
    return new TextEncoder().encode(content);
  });
  vi.spyOn(vscode.workspace.fs, 'writeFile').mockImplementation(async (uri, content) => {
    files.set(uri.fsPath, new TextDecoder().decode(content));
  });
  vi.spyOn(vscode.workspace.fs, 'stat').mockImplementation(async (uri) => {
    if (!files.has(uri.fsPath)) {
      throw new Error(`missing ${uri.fsPath}`);
    }
    return { type: vscode.FileType.File };
  });
  vi.spyOn(vscode.workspace.fs, 'readDirectory').mockImplementation(async () => []);
}

beforeEach((): void => {
  files = new Map([
    ['/workspace/.storyboard/project.json', '{}'],
    ['/workspace/draft/01-intro-copy.md', openedDraftText],
    ['/workspace/draft/01-intro.md', sceneStemDraftText],
  ]);
  useInMemoryFiles();
  vi.spyOn(vscode.workspace, 'getWorkspaceFolder').mockReturnValue(workspaceFolder);
  vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue('적용');
  vscode.window.activeTextEditor = createOpenedEditor(
    vscode.Uri.file('/workspace/draft/01-intro-copy.md'),
    openedDraftText,
  );
});

afterEach((): void => {
  vi.restoreAllMocks();
  vscode.window.activeTextEditor = undefined;
});

describe('condense draft command', () => {
  it('archives the open document when its file name differs from the front matter scene', async () => {
    const archiver: DraftHistoryArchiver = new DraftHistoryArchiver({
      fileSystem: vscodeFileSystem,
      configBridge: { isKeepDraftHistoryEnabled: (): boolean => true },
    } as unknown as HostAdapters);
    const command: CondenseDraftCommand = new CondenseDraftCommand(
      {
        drafts: {
          condense: async () => ({ kind: 'condensed', ok: true, text: '짧은 본문' }),
          archiveDraftWhenHistoryIsKept: (root, stem, draftUri) =>
            archiver.archiveWhenHistoryIsKept(root, stem, draftUri),
        },
        logger: { warn: (): void => undefined } as never,
      },
      new VirtualDocumentStore(),
    );

    await command.run();

    const archived: string[] = [...files.entries()]
      .filter(([path]) => path.startsWith('/workspace/.draft/'))
      .map(([, content]) => content);
    expect(archived).toEqual([openedDraftText]);
  });
});
