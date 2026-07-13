import * as vscode from 'vscode';

import type {
  ICardSidebarRepository,
  SidebarCardCategory,
} from '../application/cards/cardSidebarRepository';
import { resolveStoryboardWorkspaceRoot } from '../core/workspace';
import { emptyUsageSummary } from '../files/usageLedger';
import { createWebviewBridge, type StoryboardRpcHandlers } from '../messaging/bridge';
import { createAiRpcHandlers, createUsageRpcHandlers } from '../services/ai/rpcHandlers';
import { type AiProviderRegistry } from '../services/ai/providerRegistry';
import type { UsageRecorder } from '../services/ai/UsageRecorder';
import type { UsageSummaryByEntity } from '../shared/aiTypes';
import type { SidebarCardSummary, StoryboardResponsePayload } from '../shared/messaging';
import { createWebviewHtml, getWebviewDistRoot } from './webviewHtml';

const cardEditorViewType = 'storyboard.card';

interface SidebarCardsProviderOptions {
  readonly viewType: string;
  readonly cardType: SidebarCardCategory;
  readonly title: string;
  readonly cardGlob: string;
}

interface SidebarCardsInitialData {
  readonly type: SidebarCardCategory;
  readonly title: string;
  readonly cards: readonly SidebarCardSummary[];
  readonly isStoryboardProject: boolean;
  readonly usage: UsageSummaryByEntity;
}

export interface SidebarCardsProvidersDependencies {
  readonly aiProviderRegistry: AiProviderRegistry;
  readonly cardSidebarRepository: ICardSidebarRepository;
  readonly usageRecorder: UsageRecorder;
}

export class SidebarCardsProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private webviewView: vscode.WebviewView | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly dependencies: SidebarCardsProvidersDependencies,
    private readonly options: SidebarCardsProviderOptions,
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
      title: this.options.title,
      view: 'cards-sidebar',
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
      this.registerCardWatcher(storyboardRoot);
    }

    void this.refreshCards();
  }

  public dispose(): void {
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
  }

  private createHandlers(): StoryboardRpcHandlers {
    return {
      ...createAiRpcHandlers(this.dependencies.aiProviderRegistry),
      ...createUsageRpcHandlers(this.dependencies.usageRecorder),
      'cards.list': async (): Promise<StoryboardResponsePayload<'cards.list'>> => ({
        cards: await this.loadCardSummaries(),
      }),
      'cards.open': async (payload): Promise<StoryboardResponsePayload<'cards.open'>> => {
        await vscode.commands.executeCommand(
          'vscode.openWith',
          vscode.Uri.parse(payload.uri),
          cardEditorViewType,
        );

        return {};
      },
      'cards.delete': async (payload): Promise<StoryboardResponsePayload<'cards.delete'>> => {
        const targetUri = vscode.Uri.parse(payload.uri);
        const fileName = targetUri.path.split('/').at(-1) ?? this.options.cardType;
        const confirmed = await vscode.window.showWarningMessage(
          `${fileName} 카드를 삭제할까요?`,
          { modal: true },
          '삭제',
        );

        if (confirmed !== '삭제') {
          return {};
        }

        await vscode.workspace.fs.delete(targetUri);
        await this.refreshCards();

        return {};
      },
    };
  }

  private registerCardWatcher(workspaceRoot: vscode.Uri): void {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(workspaceRoot, this.options.cardGlob),
    );

    this.disposables.push(
      watcher,
      watcher.onDidCreate(() => void this.refreshCards()),
      watcher.onDidChange(() => void this.refreshCards()),
      watcher.onDidDelete(() => void this.refreshCards()),
    );
  }

  private async refreshCards(): Promise<void> {
    await this.webviewView?.webview.postMessage({
      type: 'event',
      method: 'cards.listChanged',
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

  private async createInitialData(): Promise<SidebarCardsInitialData> {
    const storyboardRoot = await resolveStoryboardWorkspaceRoot();
    const usage =
      storyboardRoot !== undefined
        ? await this.dependencies.usageRecorder.getSummary(storyboardRoot)
        : emptyUsageSummary();

    return {
      type: this.options.cardType,
      title: this.options.title,
      cards: await this.loadCardSummaries(storyboardRoot),
      isStoryboardProject: storyboardRoot !== undefined,
      usage,
    };
  }

  private async loadCardSummaries(workspaceRoot?: vscode.Uri): Promise<SidebarCardSummary[]> {
    const root = workspaceRoot ?? (await resolveStoryboardWorkspaceRoot());

    if (!root) {
      return [];
    }

    return await this.dependencies.cardSidebarRepository.list(root, this.options.cardType);
  }
}

export function registerSidebarCardsProviders(
  context: vscode.ExtensionContext,
  dependencies: SidebarCardsProvidersDependencies,
): vscode.Disposable {
  const charactersOptions: SidebarCardsProviderOptions = {
    viewType: 'storyboard.charactersView',
    cardType: 'character',
    title: 'Characters',
    cardGlob: 'character/*.card',
  };
  const backgroundsOptions: SidebarCardsProviderOptions = {
    viewType: 'storyboard.backgroundsView',
    cardType: 'background',
    title: 'Backgrounds',
    cardGlob: 'background/*.card',
  };

  const charactersProvider = new SidebarCardsProvider(
    context.extensionUri,
    dependencies,
    charactersOptions,
  );
  const backgroundsProvider = new SidebarCardsProvider(
    context.extensionUri,
    dependencies,
    backgroundsOptions,
  );

  return vscode.Disposable.from(
    vscode.window.registerWebviewViewProvider(charactersOptions.viewType, charactersProvider),
    vscode.window.registerWebviewViewProvider(backgroundsOptions.viewType, backgroundsProvider),
    charactersProvider,
    backgroundsProvider,
  );
}
