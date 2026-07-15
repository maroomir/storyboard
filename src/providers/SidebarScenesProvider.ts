import * as vscode from 'vscode';

import type { ISceneSidebarRepository } from '../application/cards/sceneSidebarRepository';
import { resolveStoryboardWorkspaceRoot } from '../infrastructure/vscode/workspace';
import { emptyUsageSummary } from '../domain/files/usageLedger';
import { createWebviewBridge, type StoryboardRpcHandlers } from '../presentation/messaging/bridge';
import {
  createAiRpcHandlers,
  createUsageRpcHandlers,
} from '../presentation/messaging/aiRpcHandlers';
import { type AiProviderRegistry } from '../infrastructure/ai/providerRegistry';
import type { UsageRecorder } from '../infrastructure/ai/UsageRecorder';
import type { UsageSummaryByEntity } from '../shared/aiTypes';
import type { StoryboardResponsePayload } from '../shared/messaging';
import type { SceneListItem } from '../shared/messaging/scenes';
import { createWebviewHtml, getWebviewDistRoot } from './webviewHtml';

const generateDraftCommand = 'storyboard.draft.generate';
const scenesSidebarViewId = 'storyboard.scenesView';

interface SidebarScenesInitialData {
  readonly title: string;
  readonly scenes: readonly SceneListItem[];
  readonly isStoryboardProject: boolean;
  readonly usage: UsageSummaryByEntity;
}

export interface SidebarScenesProviderDependencies {
  readonly aiProviderRegistry: AiProviderRegistry;
  readonly sceneSidebarRepository: ISceneSidebarRepository;
  readonly usageRecorder: UsageRecorder;
}

export class SidebarScenesProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private webviewView: vscode.WebviewView | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly dependencies: SidebarScenesProviderDependencies,
  ) {}

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.webviewView = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [getWebviewDistRoot(this.extensionUri)],
    };

    void this.bootstrapWebview(webviewView);
  }

  private async bootstrapWebview(webviewView: vscode.WebviewView): Promise<void> {
    const initialData = await this.createInitialData();

    webviewView.webview.html = createWebviewHtml(webviewView.webview, {
      extensionUri: this.extensionUri,
      title: 'Scenes',
      view: 'scenes-sidebar',
      initialData,
    });

    const bridge = createWebviewBridge(webviewView.webview, this.createHandlers());
    this.disposables.push(bridge);

    this.disposables.push(
      this.dependencies.usageRecorder.onChange(() => {
        void this.postUsageChanged();
      }),
    );

    const storyboardRoot = await resolveStoryboardWorkspaceRoot();
    if (storyboardRoot) {
      this.registerWatchers(storyboardRoot);
    }

    void this.refreshScenes();
  }

  public dispose(): void {
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
  }

  private createHandlers(): StoryboardRpcHandlers {
    return {
      ...createAiRpcHandlers(this.dependencies.aiProviderRegistry, {
        onStreamChunk: async (requestId, delta) => {
          await this.webviewView?.webview.postMessage({
            type: 'event',
            method: 'ai.generateStream.chunk',
            payload: { requestId, delta },
          });
        },
      }),
      ...createUsageRpcHandlers(this.dependencies.usageRecorder),
      'scenes.list': async (): Promise<StoryboardResponsePayload<'scenes.list'>> => ({
        scenes: await this.loadSceneList(),
      }),
      'scenes.openScene': async (
        payload,
      ): Promise<StoryboardResponsePayload<'scenes.openScene'>> => {
        const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(payload.uri));
        await vscode.window.showTextDocument(document);
        return {};
      },
      'scenes.openDraft': async (
        payload,
      ): Promise<StoryboardResponsePayload<'scenes.openDraft'>> => {
        const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(payload.uri));
        await vscode.window.showTextDocument(document);
        return {};
      },
      'scenes.generateDraft': async (
        payload,
      ): Promise<StoryboardResponsePayload<'scenes.generateDraft'>> => {
        await vscode.commands.executeCommand(generateDraftCommand, vscode.Uri.parse(payload.uri));
        return {};
      },
    };
  }

  private registerWatchers(workspaceRoot: vscode.Uri): void {
    const sceneWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(workspaceRoot, 'scene/*.txt'),
    );
    const draftWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(workspaceRoot, 'draft/**/*.md'),
    );
    const projectWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(workspaceRoot, '.storyboard/project.json'),
    );

    const refresh = (): void => {
      void this.refreshScenes();
    };

    this.disposables.push(
      sceneWatcher,
      draftWatcher,
      projectWatcher,
      sceneWatcher.onDidCreate(refresh),
      sceneWatcher.onDidChange(refresh),
      sceneWatcher.onDidDelete(refresh),
      draftWatcher.onDidCreate(refresh),
      draftWatcher.onDidChange(refresh),
      draftWatcher.onDidDelete(refresh),
      projectWatcher.onDidChange(refresh),
    );
  }

  private async refreshScenes(): Promise<void> {
    await this.webviewView?.webview.postMessage({
      type: 'event',
      method: 'scenes.listChanged',
      payload: await this.createInitialData(),
    });
  }

  private async postUsageChanged(): Promise<void> {
    const root = await resolveStoryboardWorkspaceRoot();
    const summary =
      root !== undefined
        ? await this.dependencies.usageRecorder.getSummary(root)
        : emptyUsageSummary();

    await this.webviewView?.webview.postMessage({
      type: 'event',
      method: 'usage.changed',
      payload: summary,
    });
  }

  private async createInitialData(): Promise<SidebarScenesInitialData> {
    const storyboardRoot = await resolveStoryboardWorkspaceRoot();
    const usage =
      storyboardRoot !== undefined
        ? await this.dependencies.usageRecorder.getSummary(storyboardRoot)
        : emptyUsageSummary();

    return {
      title: 'Scenes',
      scenes: await this.loadSceneList(storyboardRoot),
      isStoryboardProject: storyboardRoot !== undefined,
      usage,
    };
  }

  private async loadSceneList(workspaceRoot?: vscode.Uri): Promise<SceneListItem[]> {
    const root = workspaceRoot ?? (await resolveStoryboardWorkspaceRoot());

    if (!root) {
      return [];
    }

    return await this.dependencies.sceneSidebarRepository.list(root);
  }
}

export function registerSidebarScenesProvider(
  context: vscode.ExtensionContext,
  dependencies: SidebarScenesProviderDependencies,
): vscode.Disposable {
  const provider = new SidebarScenesProvider(context.extensionUri, dependencies);

  return vscode.Disposable.from(
    vscode.window.registerWebviewViewProvider(scenesSidebarViewId, provider),
    provider,
  );
}
