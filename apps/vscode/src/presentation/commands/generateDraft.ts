import * as vscode from 'vscode';

import {
  describeReviseOutcome,
  type GenerateDraftResult,
  type SceneGenerationPipelineStage,
} from '@storyboard/story-engine';
import type { DraftManager, RunGate } from '@storyboard/story-app';
import { confirmSceneGrounding } from './confirmSceneGrounding';
import { showStoryboardFailure } from '@/presentation/notifications/showStoryboardFailure';
import { storyboardMessages } from '@/presentation/notifications/storyboardMessages';
import { runHoldingWorkspaceLock } from './workspaceRunLock';

const GENERATE_DRAFT_COMMAND = 'storyboard.draft.generate';
const REGENERATE_DRAFT_COMMAND = 'storyboard.draft.regenerate';
const CACHE_HIT_MESSAGE = '입력이 동일하여 캐시된 초안을 엽니다.';
const REGENERATE_SUCCESS_MESSAGE = '초안을 다시 생성해 저장했습니다.';
const GENERATE_SUCCESS_MESSAGE = '초안을 생성해 저장했습니다.';

export interface RegisterGenerateDraftCommandDependencies {
  readonly runGate: Pick<RunGate, 'hold'>;
  readonly drafts: Pick<DraftManager, 'generate' | 'reviseAfterGenerate'>;
}

export function stageProgressLabel(stage: SceneGenerationPipelineStage): string {
  switch (stage) {
    case 'buildPersonas':
      return '페르소나 준비';
    case 'draftSkeleton':
      return '장면 뼈대 잡기';
    case 'polishDialogue':
      return '대사 다듬기';
    case 'attributeDialogue':
      return '대사 화자 정리';
    case 'expandSection':
      return '구간 살붙임';
    default:
      return '처리 중';
  }
}

function resolveSceneUriFromInvocation(invokedUri?: vscode.Uri): vscode.Uri | undefined {
  if (invokedUri?.scheme === 'file') {
    return invokedUri;
  }

  const document = vscode.window.activeTextEditor?.document;
  return document?.uri.scheme === 'file' ? document.uri : undefined;
}

async function openDraftResult(result: Extract<GenerateDraftResult, { ok: true }>): Promise<void> {
  const document = await vscode.workspace.openTextDocument(result.draftUri);
  await vscode.window.showTextDocument(document);
}

async function runGenerateDraftForWorkspaceScene(
  sceneUri: vscode.Uri,
  force: boolean,
  dependencies: RegisterGenerateDraftCommandDependencies,
): Promise<void> {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: force ? 'Storyboard 초안 다시 생성' : 'Storyboard 초안 생성',
      cancellable: true,
    },
    async (progress, token) => {
      progress.report({ message: '준비 중…' });

      const result = await dependencies.drafts.generate({
        sceneUri,
        force,
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
            const label = stageProgressLabel(stage);
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

      if (!result.ok) {
        if (result.kind === 'failed') {
          void showStoryboardFailure(result.message);
        }
        return;
      }

      await openDraftResult(result);

      if (result.kind === 'generated') {
        const reviseResult = await dependencies.drafts.reviseAfterGenerate(sceneUri, {
          onProgress: (message) => progress.report({ message }),
          shouldCancel: () => token.isCancellationRequested,
        });
        const reviseWarning = reviseResult && describeReviseOutcome(reviseResult).warning;
        if (reviseWarning) {
          await vscode.window.showWarningMessage(
            reviseResult?.rejection
              ? `${reviseWarning} Studio에서 '원본 축소'를 실행해 검토할 수 있습니다.`
              : reviseWarning,
          );
        }
      }

      progress.report({
        message: result.kind === 'cache_hit' ? '캐시된 초안을 열었습니다.' : '완료',
      });
      void vscode.window.showInformationMessage(
        result.kind === 'cache_hit'
          ? CACHE_HIT_MESSAGE
          : force
            ? REGENERATE_SUCCESS_MESSAGE
            : GENERATE_SUCCESS_MESSAGE,
      );
    },
  );
}

async function runCommand(
  invokedUri: vscode.Uri | undefined,
  force: boolean,
  dependencies: RegisterGenerateDraftCommandDependencies,
): Promise<void> {
  const sceneUri = resolveSceneUriFromInvocation(invokedUri);

  if (!sceneUri) {
    await vscode.window.showErrorMessage(storyboardMessages.missingSceneUri);
    return;
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(sceneUri);

  if (!workspaceFolder) {
    await runGenerateDraftForWorkspaceScene(sceneUri, force, dependencies);
    return;
  }

  await runHoldingWorkspaceLock(
    dependencies.runGate,
    workspaceFolder.uri,
    force ? '초안 다시 생성' : '초안 생성',
    () => runGenerateDraftForWorkspaceScene(sceneUri, force, dependencies),
  );
}

export function registerGenerateDraftCommands(
  dependencies: RegisterGenerateDraftCommandDependencies,
): vscode.Disposable {
  return vscode.Disposable.from(
    vscode.commands.registerCommand(GENERATE_DRAFT_COMMAND, (uri?: vscode.Uri) =>
      runCommand(uri, false, dependencies),
    ),
    vscode.commands.registerCommand(REGENERATE_DRAFT_COMMAND, (uri?: vscode.Uri) =>
      runCommand(uri, true, dependencies),
    ),
  );
}
