import * as vscode from 'vscode';
import type { IExtensionCommand } from '@/presentation/commands/extensionCommand';
import { stageProgressLabel } from '@/presentation/commands/sceneStageLabels';

import { describeReviseOutcome, type ReviseDraftWorkflowResult } from '@storyboard/story-engine';
import type {
  DraftManager,
  GenerateAndReviseDraftResult,
  ReadyDraft,
  RunGate,
} from '@storyboard/story-app';
import { confirmSceneGrounding } from '@/presentation/commands/confirmSceneGrounding';
import { showStoryboardFailure } from '@/presentation/notifications/showStoryboardFailure';
import { storyboardMessages } from '@/presentation/notifications/storyboardMessages';
import { runHoldingWorkspaceLock } from '@/presentation/commands/workspaceRunLock';
import { resolveSceneUriFromInvocation } from '@/presentation/commands/sceneInvocation';

const CACHE_HIT_MESSAGE: string = '입력이 동일하여 캐시된 초안을 엽니다.';
const REGENERATE_SUCCESS_MESSAGE: string = '초안을 다시 생성해 저장했습니다.';
const GENERATE_SUCCESS_MESSAGE: string = '초안을 생성해 저장했습니다.';

export interface GenerateDraftCommandDependencies {
  readonly runGate: Pick<RunGate, 'hold'>;
  readonly drafts: Pick<DraftManager, 'generateAndRevise'>;
}

export interface GenerateDraftOptions {
  readonly shouldOverwrite: boolean;
}

interface DraftProgressReporter {
  readonly progress: vscode.Progress<{ readonly message?: string }>;
  readonly token: vscode.CancellationToken;
}

export abstract class GenerateDraftCommandBase implements IExtensionCommand {
  public abstract readonly id: string;

  protected constructor(private readonly dependencies: GenerateDraftCommandDependencies) {}

  public abstract run(...args: never[]): unknown;

  protected async generate(
    invokedUri: vscode.Uri | undefined,
    { shouldOverwrite }: GenerateDraftOptions,
  ): Promise<void> {
    const sceneUri: vscode.Uri | undefined = resolveSceneUriFromInvocation(invokedUri);

    if (!sceneUri) {
      await vscode.window.showErrorMessage(storyboardMessages.missingSceneUri);
      return;
    }

    const workspaceFolder: vscode.WorkspaceFolder | undefined =
      vscode.workspace.getWorkspaceFolder(sceneUri);

    if (!workspaceFolder) {
      await this.generateForWorkspaceScene(sceneUri, shouldOverwrite);
      return;
    }

    await runHoldingWorkspaceLock(
      this.dependencies.runGate,
      workspaceFolder.uri,
      shouldOverwrite ? '초안 다시 생성' : '초안 생성',
      () => this.generateForWorkspaceScene(sceneUri, shouldOverwrite),
    );
  }

  private async generateForWorkspaceScene(
    sceneUri: vscode.Uri,
    shouldOverwrite: boolean,
  ): Promise<void> {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: shouldOverwrite ? 'Storyboard 초안 다시 생성' : 'Storyboard 초안 생성',
        cancellable: true,
      },
      (progress, token) =>
        this.generateWithProgress(sceneUri, shouldOverwrite, { progress, token }),
    );
  }

  private async generateWithProgress(
    sceneUri: vscode.Uri,
    shouldOverwrite: boolean,
    reporter: DraftProgressReporter,
  ): Promise<void> {
    reporter.progress.report({ message: '준비 중…' });

    const { generation, revision }: GenerateAndReviseDraftResult = await this.requestDraft(
      sceneUri,
      shouldOverwrite,
      reporter,
    );

    if (!generation.ok) {
      if (generation.kind === 'failed') {
        void showStoryboardFailure(generation.message);
      }
      return;
    }

    await warnAboutRevision(revision);

    reporter.progress.report({
      message: generation.kind === 'cache_hit' ? '캐시된 초안을 열었습니다.' : '완료',
    });
    void vscode.window.showInformationMessage(
      generation.kind === 'cache_hit'
        ? CACHE_HIT_MESSAGE
        : shouldOverwrite
          ? REGENERATE_SUCCESS_MESSAGE
          : GENERATE_SUCCESS_MESSAGE,
    );
  }

  private async requestDraft(
    sceneUri: vscode.Uri,
    shouldOverwrite: boolean,
    { progress, token }: DraftProgressReporter,
  ): Promise<GenerateAndReviseDraftResult> {
    return await this.dependencies.drafts.generateAndRevise({
      sceneUri,
      force: shouldOverwrite,
      isReviseAllowed: true,
      onDraftReady: openDraftResult,
      onReviseProgress: (message) => progress.report({ message }),
      confirmSceneGrounding,
      onTraitsUpdateComplete: (summary) => {
        if (summary.updatedCardCount > 0) {
          void vscode.window.showInformationMessage(
            `캐릭터 카드 ${summary.updatedCardCount}개에 특성·최근 대사를 반영했습니다.`,
          );
        }
      },
      onPipelineProgress: (stage, current, total) => {
        if (!token.isCancellationRequested) {
          const label: string = stageProgressLabel(stage);
          progress.report({
            message: total > 1 ? `${label} (${current}/${total})…` : `${label}…`,
          });
        }
      },
      onSaving: () => {
        if (!token.isCancellationRequested) {
          progress.report({ message: '파일 저장 중…' });
        }
      },
      shouldCancel: () => token.isCancellationRequested,
    });
  }
}

async function openDraftResult(generated: ReadyDraft): Promise<void> {
  const document: vscode.TextDocument = await vscode.workspace.openTextDocument(generated.draftUri);
  await vscode.window.showTextDocument(document);
}

async function warnAboutRevision(revision: ReviseDraftWorkflowResult | undefined): Promise<void> {
  const reviseWarning: string | undefined = revision && describeReviseOutcome(revision).warning;

  if (reviseWarning) {
    await vscode.window.showWarningMessage(
      revision?.rejection
        ? `${reviseWarning} Studio에서 '원본 축소'를 실행해 검토할 수 있습니다.`
        : reviseWarning,
    );
  }
}
