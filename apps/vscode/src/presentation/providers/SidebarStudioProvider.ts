import { vscodeFileSystem } from '@/infrastructure/vscode/vscodeFileSystem';
import * as vscode from 'vscode';

import type { ConfigBridge } from '@storyboard/story-ai';

import type { IStoryboardLogger } from '@storyboard/story-engine';

import { resolveStoryboardWorkspaceRoot } from '@/infrastructure/vscode/workspace';
import { StudioSessionRepository, type IStudioSessionRepository } from '@storyboard/story-engine';
import { StudioFollowUpRepository, type IStudioFollowUpRepository } from '@storyboard/story-engine';
import { readStudioStage } from '@storyboard/story-engine';
import type { ProposalReviewService } from './proposalReviewService';
import { createWebviewBridge, type StoryboardRpcHandlers } from '@/presentation/messaging/bridge';
import type {
  StoryboardResponsePayload,
  StudioSessionSnapshot,
  StudioTarget,
} from '@storyboard/story-engine';
import type { StudioChatStage, StudioChatUseCase } from '@storyboard/story-engine';
import type { AiGateway } from '@storyboard/story-engine';
import type { CollectCardProposalsUseCase } from '@storyboard/story-engine';
import type { CreateCardUseCase } from '@storyboard/story-engine';
import { StudioToolDiagnostics } from './studioToolDiagnostics';
import { createStudioCardUpdateRpcHandlers } from '@/presentation/messaging/studioCardUpdateRpcHandlers';
import { createStudioChatRpcHandlers } from '@/presentation/messaging/studioChatRpcHandlers';
import { createStudioFollowUpRpcHandlers } from '@/presentation/messaging/studioFollowUpRpcHandlers';
import { createStudioProposalRpcHandlers } from '@/presentation/messaging/studioProposalRpcHandlers';
import { createStudioSessionRpcHandlers } from '@/presentation/messaging/studioSessionRpcHandlers';
import { computeStudioTarget, resolveActiveStudioFocus } from './studioTarget';
import { createWebviewHtml, getWebviewDistRoot } from './webviewHtml';
import { sidebarViewIds } from '@/contributionIds';

interface SidebarStudioInitialData {
  readonly title: string;
  readonly target: StudioTarget;
  readonly session?: StudioSessionSnapshot;
}

export class SidebarStudioProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private webviewView: vscode.WebviewView | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private lastTargetKey: string | undefined;

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly sessionRepository: IStudioSessionRepository,
    private readonly chatUseCase: StudioChatUseCase,
    private readonly aiGateway: AiGateway,
    private readonly collectUseCase: CollectCardProposalsUseCase,
    private readonly createCardUseCase: CreateCardUseCase,
    private readonly toolDiagnostics: StudioToolDiagnostics,
    private readonly reviewService: ProposalReviewService,
    private readonly followUpRepository: IStudioFollowUpRepository,
    private readonly configBridge: ConfigBridge,
    private readonly logger: IStoryboardLogger,
  ) {}

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.webviewView = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [getWebviewDistRoot(this.extensionUri)],
    };

    void this.bootstrapWebview(webviewView);
  }

  public dispose(): void {
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
  }

  private async bootstrapWebview(webviewView: vscode.WebviewView): Promise<void> {
    const target = await computeStudioTarget(resolveActiveStudioFocus());
    this.lastTargetKey = JSON.stringify(target);

    const root = await resolveStoryboardWorkspaceRoot();
    const session =
      root && target.entity
        ? await this.sessionRepository.loadLatest(root, target.entity)
        : undefined;

    const initialData: SidebarStudioInitialData = { title: 'Studio', target, session };

    webviewView.webview.html = createWebviewHtml(webviewView.webview, {
      extensionUri: this.extensionUri,
      title: 'Studio',
      view: 'studio-sidebar',
      initialData,
    });

    const bridge = createWebviewBridge(webviewView.webview, this.createHandlers());
    this.disposables.push(bridge);

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => {
        void this.postTargetChanged();
      }),
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (event.textEditor === vscode.window.activeTextEditor) {
          void this.postTargetChanged();
        }
      }),
      vscode.window.tabGroups.onDidChangeTabs(() => {
        void this.postTargetChanged();
      }),
      vscode.window.tabGroups.onDidChangeTabGroups(() => {
        void this.postTargetChanged();
      }),
    );
  }

  private createHandlers(): StoryboardRpcHandlers {
    return {
      'studio.stage': async (): Promise<StoryboardResponsePayload<'studio.stage'>> => {
        const root = await resolveStoryboardWorkspaceRoot();

        if (!root) {
          return {};
        }

        const target = await computeStudioTarget(resolveActiveStudioFocus());
        return { stage: await readStudioStage(vscodeFileSystem, root, target) };
      },
      ...createStudioChatRpcHandlers({
        useCase: this.chatUseCase,
        aiGateway: this.aiGateway,
        collectUseCase: this.collectUseCase,
        logger: this.logger,
        toolDiagnostics: this.toolDiagnostics,
        configBridge: this.configBridge,
        getProjectRoot: () => resolveStoryboardWorkspaceRoot(),
        getTarget: () => computeStudioTarget(resolveActiveStudioFocus()),
        postProgress: (stage) => this.postChatProgress(stage),
      }),
      ...createStudioCardUpdateRpcHandlers({
        aiGateway: this.aiGateway,
        createCardUseCase: this.createCardUseCase,
        logger: this.logger,
        getProjectRoot: () => resolveStoryboardWorkspaceRoot(),
      }),
      ...createStudioProposalRpcHandlers({
        reviewService: this.reviewService,
        followUpRepository: this.followUpRepository,
        configBridge: this.configBridge,
        logger: this.logger,
        getProjectRoot: () => resolveStoryboardWorkspaceRoot(),
        createFollowUpId: () => crypto.randomUUID(),
      }),
      ...createStudioFollowUpRpcHandlers({
        repository: this.followUpRepository,
        getProjectRoot: () => resolveStoryboardWorkspaceRoot(),
      }),
      ...createStudioSessionRpcHandlers({
        repository: this.sessionRepository,
        getProjectRoot: () => resolveStoryboardWorkspaceRoot(),
      }),
    };
  }

  private postChatProgress(stage: StudioChatStage | 'idle'): void {
    void this.webviewView?.webview.postMessage({
      type: 'event',
      method: 'studio.chat.progress',
      payload: { stage },
    });
  }

  private async postTargetChanged(): Promise<void> {
    const target = await computeStudioTarget(resolveActiveStudioFocus());
    const key = JSON.stringify(target);

    if (key === this.lastTargetKey) {
      return;
    }

    this.lastTargetKey = key;

    await this.webviewView?.webview.postMessage({
      type: 'event',
      method: 'studio.targetChanged',
      payload: target,
    });
  }
}

export function registerSidebarStudioProvider(
  context: vscode.ExtensionContext,
  chatUseCase: StudioChatUseCase,
  aiGateway: AiGateway,
  collectUseCase: CollectCardProposalsUseCase,
  createCardUseCase: CreateCardUseCase,
  reviewService: ProposalReviewService,
  configBridge: ConfigBridge,
  logger: IStoryboardLogger,
): vscode.Disposable {
  const toolDiagnostics = new StudioToolDiagnostics();
  const provider = new SidebarStudioProvider(
    context.extensionUri,
    new StudioSessionRepository(vscodeFileSystem),
    chatUseCase,
    aiGateway,
    collectUseCase,
    createCardUseCase,
    toolDiagnostics,
    reviewService,
    new StudioFollowUpRepository(vscodeFileSystem),
    configBridge,
    logger,
  );

  return vscode.Disposable.from(
    vscode.window.registerWebviewViewProvider(sidebarViewIds.studio, provider),
    provider,
    toolDiagnostics,
  );
}
