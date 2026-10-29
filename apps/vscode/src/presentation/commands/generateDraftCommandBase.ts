import * as vscode from 'vscode';
import type { IExtensionCommand } from '@/presentation/commands/extensionCommand';
import { stageProgressLabel } from '@/presentation/commands/sceneStageLabels';

import {
  describeReviseOutcome,
  type GenerateDraftResult,
  type ReviseDraftWorkflowResult,
} from '@storyboard/story-engine';
import type { DraftManager, RunGate } from '@storyboard/story-app';
import { confirmSceneGrounding } from './confirmSceneGrounding';
import { showStoryboardFailure } from '@/presentation/notifications/showStoryboardFailure';
import { storyboardMessages } from '@/presentation/notifications/storyboardMessages';
import { runHoldingWorkspaceLock } from './workspaceRunLock';
import { resolveSceneUriFromInvocation } from '@/presentation/commands/sceneInvocation';

const CACHE_HIT_MESSAGE: string = '입력이 동일하여 캐시된 초안을 엽니다.';
const REGENERATE_SUCCESS_MESSAGE: string = '초안을 다시 생성해 저장했습니다.';
const GENERATE_SUCCESS_MESSAGE: string = '초안을 생성해 저장했습니다.';

export interface GenerateDraftCommandDependencies {
  readonly runGate: Pick<RunGate, 'hold'>;
  readonly drafts: Pick<DraftManager, 'generate' | 'reviseAfterGenerate'>;
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

    const draftGeneration: GenerateDraftResult = await this.requestDraft(
      sceneUri,
      shouldOverwrite,
      reporter,
    );

    if (!draftGeneration.ok) {
      if (draftGeneration.kind === 'failed') {
        void showStoryboardFailure(draftGeneration.message);
      }
      return;
    }

    await openDraftResult(draftGeneration);

    if (draftGeneration.kind === 'generated') {
      await this.reviseGeneratedDraft(sceneUri, reporter);
    }

    reporter.progress.report({
      message: draftGeneration.kind === 'cache_hit' ? '캐시된 초안을 열었습니다.' : '완료',
    });
    void vscode.window.showInformationMessage(
      draftGeneration.kind === 'cache_hit'
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
  ): Promise<GenerateDraftResult> {
    return await this.dependencies.drafts.generate({
      sceneUri,
      force: shouldOverwrite,
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

  private async reviseGeneratedDraft(
    sceneUri: vscode.Uri,
    { progress, token }: DraftProgressReporter,
  ): Promise<void> {
    const reviseResult: ReviseDraftWorkflowResult | undefined =
      await this.dependencies.drafts.reviseAfterGenerate(sceneUri, {
        onProgress: (message) => progress.report({ message }),
        shouldCancel: () => token.isCancellationRequested,
      });
    const reviseWarning: string | undefined =
      reviseResult && describeReviseOutcome(reviseResult).warning;
    if (reviseWarning) {
      await vscode.window.showWarningMessage(
        reviseResult?.rejection
          ? `${reviseWarning} Studio에서 '원본 축소'를 실행해 검토할 수 있습니다.`
          : reviseWarning,
      );
    }
  }
}

async function openDraftResult(
  generated: Extract<GenerateDraftResult, { ok: true }>,
): Promise<void> {
  const document: vscode.TextDocument = await vscode.workspace.openTextDocument(generated.draftUri);
  await vscode.window.showTextDocument(document);
}
