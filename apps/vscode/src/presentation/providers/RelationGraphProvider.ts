import type { CardManager } from '@storyboard/story-app';
import type { DisposableHandle, RelationGraphInitialData } from '@storyboard/story-model';
import * as vscode from 'vscode';

import { resolveStoryboardWorkspaceRoot } from '@/infrastructure/vscode/workspace';
import { createWebviewBridge, type StoryboardRpcHandlers } from '@/presentation/messaging/bridge';
import { AiRpc } from '@/presentation/messaging/aiRpcHandlers';
import type { AiProviderRegistry } from '@storyboard/story-ai';
import type { RelationListCharacter, StoryboardResponsePayload } from '@storyboard/story-model';
import { createWebviewHtml, getWebviewDistRoot } from '@/presentation/providers/webviewHtml';
import { cardEditorViewType } from '@/contributionIds';
import { STORYBOARD_GLOBS } from '@storyboard/story-model';

const panelViewType: string = 'storyboard.relationGraph';

export interface RelationGraphPanelDependencies {
  readonly aiProviderRegistry: AiProviderRegistry;
  readonly cards: Pick<CardManager, 'listRelationCharacters'>;
}

export interface IRelationGraphPanel extends vscode.Disposable {
  reveal(extensionUri: vscode.Uri): void;
}

export class RelationGraphProvider implements IRelationGraphPanel {
  private panel: vscode.WebviewPanel | undefined;
  private bridge: DisposableHandle | undefined;
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
    const initialData: RelationGraphInitialData = await createRelationGraphInitialData(
      this.dependencies.cards,
    );

    const panel: vscode.WebviewPanel = vscode.window.createWebviewPanel(
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

    const storyboardRoot: vscode.Uri | undefined = await resolveStoryboardWorkspaceRoot();
    if (storyboardRoot) {
      const watcher: vscode.FileSystemWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(storyboardRoot, STORYBOARD_GLOBS.characterCards),
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
      payload: await createRelationGraphInitialData(this.dependencies.cards),
    });
  }

  private createHandlers(): StoryboardRpcHandlers {
    return {
      ...new AiRpc(this.dependencies.aiProviderRegistry).handlers(),
      'relations.list': async (): Promise<StoryboardResponsePayload<'relations.list'>> => ({
        characters: await loadRelationListCharactersForRpc(this.dependencies.cards),
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

async function createRelationGraphInitialData(
  cards: Pick<CardManager, 'listRelationCharacters'>,
): Promise<RelationGraphInitialData> {
  const storyboardRoot: vscode.Uri | undefined = await resolveStoryboardWorkspaceRoot();

  return {
    title: 'Character Relations',
    characters: storyboardRoot ? await cards.listRelationCharacters(storyboardRoot) : [],
    isStoryboardProject: storyboardRoot !== undefined,
  };
}

async function loadRelationListCharactersForRpc(
  cards: Pick<CardManager, 'listRelationCharacters'>,
): Promise<RelationListCharacter[]> {
  const storyboardRoot: vscode.Uri | undefined = await resolveStoryboardWorkspaceRoot();

  if (!storyboardRoot) {
    return [];
  }

  return cards.listRelationCharacters(storyboardRoot);
}
