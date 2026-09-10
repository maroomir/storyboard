import { vscodeFileSystem } from '@/infrastructure/vscode/vscodeFileSystem';
import * as vscode from 'vscode';

import { loadRelationListCharacters } from '@storyboard/story-engine';
import { resolveStoryboardWorkspaceRoot } from '@/infrastructure/vscode/workspace';
import { createWebviewBridge, type StoryboardRpcHandlers } from '@/presentation/messaging/bridge';
import { createAiRpcHandlers } from '@/presentation/messaging/aiRpcHandlers';
import type { AiProviderRegistry } from '@storyboard/story-ai';
import type { RelationListCharacter, StoryboardResponsePayload } from '@storyboard/story-engine';
import { createWebviewHtml, getWebviewDistRoot } from './webviewHtml';
import { cardEditorViewType } from '@/contributionIds';

const panelViewType = 'storyboard.relationGraph';

export interface RelationGraphPanelDependencies {
  readonly aiProviderRegistry: AiProviderRegistry;
}

export interface IRelationGraphPanel extends vscode.Disposable {
  reveal(extensionUri: vscode.Uri): void;
}

interface RelationGraphInitialData {
  readonly title: string;
  readonly characters: readonly RelationListCharacter[];
  readonly isStoryboardProject: boolean;
}

export class RelationGraphProvider implements IRelationGraphPanel {
  private panel: vscode.WebviewPanel | undefined;
  private bridge: { readonly dispose: () => void } | undefined;
  private watchers: vscode.Disposable | undefined;

  public constructor(private readonly dependencies: RelationGraphPanelDependencies) {}

  public reveal(extensionUri: vscode.Uri): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active);
      void this.refreshWebview();
      return;
    }

    void this.open(extensionUri);
  }

  public dispose(): void {
    this.panel?.dispose();
    this.clearPanelResources();
  }

  private async open(extensionUri: vscode.Uri): Promise<void> {
    const initialData = await createRelationGraphInitialData();

    const panel = vscode.window.createWebviewPanel(
      panelViewType,
      'Character Relations',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [getWebviewDistRoot(extensionUri)],
      },
    );

    this.panel = panel;

    panel.webview.html = createWebviewHtml(panel.webview, {
      extensionUri,
      title: 'Character Relations',
      view: 'relation-graph',
      initialData,
    });

    this.bridge = createWebviewBridge(panel.webview, this.createHandlers());

    const storyboardRoot = await resolveStoryboardWorkspaceRoot();
    if (storyboardRoot) {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(storyboardRoot, 'character/*.card'),
      );
      const scheduleRefresh = (): void => {
        void this.refreshWebview();
      };

      this.watchers = vscode.Disposable.from(
        watcher,
        watcher.onDidCreate(scheduleRefresh),
        watcher.onDidChange(scheduleRefresh),
        watcher.onDidDelete(scheduleRefresh),
      );
    }

    panel.onDidDispose(() => this.clearPanelResources());
  }

  private async refreshWebview(): Promise<void> {
    if (!this.panel) {
      return;
    }

    await this.panel.webview.postMessage({
      type: 'event',
      method: 'relations.listChanged',
      payload: await createRelationGraphInitialData(),
    });
  }

  private createHandlers(): StoryboardRpcHandlers {
    return {
      ...createAiRpcHandlers(this.dependencies.aiProviderRegistry),
      'relations.list': async (): Promise<StoryboardResponsePayload<'relations.list'>> => ({
        characters: await loadRelationListCharactersForRpc(),
      }),
      'cards.open': async (payload): Promise<StoryboardResponsePayload<'cards.open'>> => {
        await vscode.commands.executeCommand(
          'vscode.openWith',
          vscode.Uri.parse(payload.uri),
          cardEditorViewType,
        );
        return {};
      },
    };
  }

  private clearPanelResources(): void {
    this.bridge?.dispose();
    this.bridge = undefined;
    this.watchers?.dispose();
    this.watchers = undefined;
    this.panel = undefined;
  }
}

async function createRelationGraphInitialData(): Promise<RelationGraphInitialData> {
  const storyboardRoot = await resolveStoryboardWorkspaceRoot();

  return {
    title: 'Character Relations',
    characters: storyboardRoot
      ? await loadRelationListCharacters(vscodeFileSystem, storyboardRoot)
      : [],
    isStoryboardProject: storyboardRoot !== undefined,
  };
}

async function loadRelationListCharactersForRpc(): Promise<RelationListCharacter[]> {
  const storyboardRoot = await resolveStoryboardWorkspaceRoot();

  if (!storyboardRoot) {
    return [];
  }

  return loadRelationListCharacters(vscodeFileSystem, storyboardRoot);
}
