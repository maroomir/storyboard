import * as vscode from 'vscode';

import type { ConfigBridge } from '@storyboard/story-ai';

import type { StoryboardLogger } from '../../infrastructure/vscode/logger';

import { resolveStoryboardWorkspaceRoot } from '../../infrastructure/vscode/workspace';
import {
  StudioSessionRepository,
  type IStudioSessionRepository,
} from '../../infrastructure/persistence/repositories/studioSessionRepository';
import {
  StudioFollowUpRepository,
  type IStudioFollowUpRepository,
} from '../../infrastructure/persistence/repositories/studioFollowUpRepository';
import { readStudioStage } from '../../infrastructure/persistence/studioStage';
import type { ProposalReviewService } from './proposalReviewService';
import { createWebviewBridge, type StoryboardRpcHandlers } from '../messaging/bridge';
import type {
  StoryboardResponsePayload,
  StudioSessionSnapshot,
  StudioTarget,
} from '../../shared/messaging';
import type {
  StudioChatStage,
  StudioChatUseCase,
} from '../../application/studio/studioChatUseCase';
import { createStudioChatRpcHandlers } from '../messaging/studioChatRpcHandlers';
import { createStudioFollowUpRpcHandlers } from '../messaging/studioFollowUpRpcHandlers';
import { createStudioProposalRpcHandlers } from '../messaging/studioProposalRpcHandlers';
import { createStudioSessionRpcHandlers } from '../messaging/studioSessionRpcHandlers';
import { computeStudioTarget } from './studioTarget';
import { createWebviewHtml, getWebviewDistRoot } from './webviewHtml';

const studioSidebarViewId = 'storyboard.studioView';

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
    private readonly reviewService: ProposalReviewService,
    private readonly followUpRepository: IStudioFollowUpRepository,
    private readonly configBridge: ConfigBridge,
    private readonly logger: StoryboardLogger,
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
    const target = await computeStudioTarget(vscode.window.activeTextEditor);
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
    );
  }

  private createHandlers(): StoryboardRpcHandlers {
    return {
      'studio.stage': async (): Promise<StoryboardResponsePayload<'studio.stage'>> => {
        const root = await resolveStoryboardWorkspaceRoot();

        if (!root) {
          return {};
        }

        const target = await computeStudioTarget(vscode.window.activeTextEditor);
        return { stage: await readStudioStage(root, target) };
      },
      ...createStudioChatRpcHandlers({
        useCase: this.chatUseCase,
        getProjectRoot: () => resolveStoryboardWorkspaceRoot(),
        getTarget: () => computeStudioTarget(vscode.window.activeTextEditor),
        postProgress: (stage) => this.postChatProgress(stage),
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
    const target = await computeStudioTarget(vscode.window.activeTextEditor);
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
  reviewService: ProposalReviewService,
  configBridge: ConfigBridge,
  logger: StoryboardLogger,
): vscode.Disposable {
  const provider = new SidebarStudioProvider(
    context.extensionUri,
    new StudioSessionRepository(),
    chatUseCase,
    reviewService,
    new StudioFollowUpRepository(),
    configBridge,
    logger,
  );

  return vscode.Disposable.from(
    vscode.window.registerWebviewViewProvider(studioSidebarViewId, provider),
    provider,
  );
}
