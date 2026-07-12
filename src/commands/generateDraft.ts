import * as vscode from 'vscode';

import {
  type GenerateDraftUseCase,
  type GenerateDraftResult,
} from '../application/drafts/generate-draft-use-case';
import type { ReviseDraftUseCase } from '../application/drafts/revise-draft-use-case';
import type { StoryboardLogger } from '../core/logger';
import { maybeRunReviseAfterGenerate } from './reviseDraft';
import type { ConfigBridge } from '../services/settings/ConfigBridge';
import type { SceneGenerationPipelineStage } from '../application/pipelines/scene-generation-pipeline';

const GENERATE_DRAFT_COMMAND = 'storyboard.draft.generate';
const REGENERATE_DRAFT_COMMAND = 'storyboard.draft.regenerate';
const CACHE_HIT_MESSAGE = '입력이 동일하여 캐시된 초안을 엽니다.';
const REGENERATE_SUCCESS_MESSAGE = '초안을 다시 생성해 저장했습니다.';
const GENERATE_SUCCESS_MESSAGE = '초안을 생성해 저장했습니다.';

export interface RegisterGenerateDraftCommandDependencies {
  readonly configBridge: ConfigBridge;
  readonly generateDraftUseCase: GenerateDraftUseCase;
  readonly logger: StoryboardLogger;
  readonly reviseDraftUseCase: ReviseDraftUseCase;
}

export function stageProgressLabel(stage: SceneGenerationPipelineStage): string {
  switch (stage) {
    case 'extractSituations':
      return '상황 추출';
    case 'buildPersonas':
      return '페르소나 준비';
    case 'generateDialogue':
      return '대화 생성';
    case 'applyFormat':
      return '장르 포맷 적용';
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

      const result = await dependencies.generateDraftUseCase.execute(sceneUri, {
        force,
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
          void vscode.window.showErrorMessage(result.message);
        }
        return;
      }

      await openDraftResult(result);

      if (result.kind === 'generated') {
        await maybeRunReviseAfterGenerate(
          sceneUri,
          dependencies.configBridge,
          {
            logger: dependencies.logger,
            reviseDraftUseCase: dependencies.reviseDraftUseCase,
          },
          {
            onProgress: (message) => progress.report({ message }),
            shouldCancel: () => token.isCancellationRequested,
          },
        );
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
    await vscode.window.showErrorMessage(
      '씬 파일 URI가 없습니다. `scene` 폴더의 `.txt` 파일을 열거나 탐색기에서 명령을 실행해 주세요.',
    );
    return;
  }

  await runGenerateDraftForWorkspaceScene(sceneUri, force, dependencies);
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
