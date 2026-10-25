import * as vscode from 'vscode';

import type { DraftManager } from '@storyboard/story-app';
import type { IStoryboardLogger, ReviseDraftWorkflowResult } from '@storyboard/story-engine';
import {
  draftPath,
  extractErrorMessage,
  parseSceneStem,
  type StoryUri,
} from '@storyboard/story-model';
import { hasStoryboardProject, uriExists } from '@/infrastructure/vscode/workspace';
import type { ConfigBridge } from '@storyboard/story-ai';
import { showStoryboardFailure } from '@/presentation/notifications/showStoryboardFailure';

const reviseDraftCommand: string = 'storyboard.draft.reviseLoop';

export interface RegisterReviseDraftCommandDependencies {
  readonly configBridge: ConfigBridge;
  readonly logger: IStoryboardLogger;
  readonly drafts: Pick<DraftManager, 'reviseScene'>;
}

export function registerReviseDraftCommand(
  dependencies: RegisterReviseDraftCommandDependencies,
): vscode.Disposable {
  return vscode.commands.registerCommand(reviseDraftCommand, (uri?: vscode.Uri) =>
    runReviseDraft(uri, dependencies),
  );
}

function resolveSceneStem(uri: vscode.Uri): string | undefined {
  const fileName: string = uri.path.split('/').pop() ?? '';
  const stem: string = fileName.replace(/\.(md|txt)$/, '');
  return parseSceneStem(stem) ? stem : undefined;
}

async function runReviseDraft(
  invokedUri: vscode.Uri | undefined,
  dependencies: RegisterReviseDraftCommandDependencies,
): Promise<void> {
  const targetUri: vscode.Uri | undefined =
    invokedUri ?? vscode.window.activeTextEditor?.document.uri;

  if (!targetUri || targetUri.scheme !== 'file') {
    await vscode.window.showErrorMessage('씬 또는 초안 파일을 연 뒤 다시 시도해 주세요.');
    return;
  }

  const workspaceFolder: vscode.WorkspaceFolder | undefined =
    vscode.workspace.getWorkspaceFolder(targetUri);

  if (!workspaceFolder || !(await hasStoryboardProject(workspaceFolder))) {
    await vscode.window.showWarningMessage('Storyboard 프로젝트가 아닙니다.');
    return;
  }

  const sceneStem: string | undefined = resolveSceneStem(targetUri);

  if (!sceneStem) {
    await vscode.window.showErrorMessage('씬/초안 파일명은 `NN-slug` 형식이어야 합니다.');
    return;
  }

  const draftUri: StoryUri = draftPath(workspaceFolder.uri, sceneStem);

  if (!(await uriExists(draftUri))) {
    await vscode.window.showInformationMessage(
      '초안이 없습니다. 먼저 Generate Draft를 실행해 주세요.',
    );
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Storyboard 초안 검수·재작성',
      cancellable: true,
    },
    async (progress, token) => {
      try {
        const revision: ReviseDraftWorkflowResult | undefined =
          await dependencies.drafts.reviseScene(workspaceFolder.uri, sceneStem, {
            onProgress: (message) => progress.report({ message }),
            shouldCancel: () => token.isCancellationRequested,
          });

        if (!revision) {
          await vscode.window.showInformationMessage(
            '초안이 없습니다. 먼저 Generate Draft를 실행해 주세요.',
          );
          return;
        }

        const document: vscode.TextDocument = await vscode.workspace.openTextDocument(draftUri);
        await vscode.window.showTextDocument(document);
        await reportResult(revision);
      } catch (error) {
        dependencies.logger.error('Draft revise loop failed', error);
        dependencies.logger.show();
        const message: string = extractErrorMessage(error);
        await showStoryboardFailure(`초안 검수·재작성에 실패했습니다: ${message}`);
      }
    },
  );
}

async function reportResult(revision: {
  readonly passed: boolean;
  readonly revisionCount: number;
  readonly remainingBlocking: number;
  readonly cancelled: boolean;
  readonly preservedOriginal: boolean;
  readonly rejection?: {
    readonly reason: string;
    readonly originalLength: number;
    readonly candidateLength: number;
  };
}): Promise<void> {
  if (revision.preservedOriginal && revision.rejection) {
    await vscode.window.showWarningMessage(
      `재작성 결과가 분량·본문 형식·장면 구분(---) 기준을 통과하지 않아 원본을 유지했습니다 (${revision.rejection.candidateLength}자 / 원본 ${revision.rejection.originalLength}자). Studio에서 '원본 축소'를 실행해 검토할 수 있습니다.`,
    );
    return;
  }

  if (revision.cancelled && !revision.passed) {
    await vscode.window.showWarningMessage(
      `검수·재작성을 취소했습니다. (재작성 ${revision.revisionCount}회)`,
    );
    return;
  }

  if (revision.passed) {
    await vscode.window.showInformationMessage(
      revision.revisionCount === 0
        ? '검수를 통과했습니다. 수정할 항목이 없습니다.'
        : `검수를 통과했습니다. 초안을 ${revision.revisionCount}회 재작성했습니다.`,
    );
    return;
  }

  await vscode.window.showWarningMessage(
    `재작성 ${revision.revisionCount}회 후에도 차단 이슈 ${revision.remainingBlocking}개가 남았습니다. 초안을 직접 검토해 주세요.`,
  );
}
