import * as vscode from 'vscode';

import type { ReviewManuscriptUseCase } from '@storyboard/story-engine';
import type { IStoryboardLogger } from '@storyboard/story-engine';
import { resolveStoryboardWorkspaceRoot } from '@/infrastructure/vscode/workspace';
import { showStoryboardFailure } from '@/presentation/notifications/showStoryboardFailure';
import { storyboardMessages } from '@/presentation/notifications/storyboardMessages';

const reviewManuscriptCommand = 'storyboard.manuscript.review';

export interface RegisterReviewManuscriptCommandDependencies {
  readonly logger: IStoryboardLogger;
  readonly reviewManuscriptUseCase: ReviewManuscriptUseCase;
}

export function registerReviewManuscriptCommand(
  dependencies: RegisterReviewManuscriptCommandDependencies,
): vscode.Disposable {
  return vscode.commands.registerCommand(reviewManuscriptCommand, () =>
    runReviewManuscript(dependencies),
  );
}

async function runReviewManuscript(
  dependencies: RegisterReviewManuscriptCommandDependencies,
): Promise<void> {
  const workspaceRoot = await resolveStoryboardWorkspaceRoot();
  if (!workspaceRoot) {
    await vscode.window.showErrorMessage(storyboardMessages.missingWorkspace);
    return;
  }

  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Storyboard 원고 최종 검사',
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: '연속성·비평 검사 중…' });
      return await dependencies.reviewManuscriptUseCase.execute({ workspaceRoot });
    },
  );

  if (!result.ok) {
    await reportFailure(result, dependencies.logger);
    return;
  }

  const document = await vscode.workspace.openTextDocument(result.reportUri);
  await vscode.window.showTextDocument(document);

  const total = result.continuityCount + result.critiqueCount;
  await vscode.window.showInformationMessage(
    total === 0
      ? '원고 최종 검사를 마쳤습니다. 발견된 이슈가 없습니다.'
      : `원고 최종 검사를 마쳤습니다. 설정 모순 ${result.continuityCount}건, 비평 ${result.critiqueCount}건.`,
  );
}

async function reportFailure(
  result: Exclude<Awaited<ReturnType<ReviewManuscriptUseCase['execute']>>, { readonly ok: true }>,
  logger: IStoryboardLogger,
): Promise<void> {
  if (result.kind === 'missing_outline') {
    await vscode.window.showWarningMessage(storyboardMessages.missingOutline);
    return;
  }
  if (result.kind === 'missing_drafts') {
    await vscode.window.showInformationMessage(
      '검사할 초안이 없습니다. 먼저 Generate (All) Drafts를 실행해 주세요.',
    );
    return;
  }

  logger.error('Manuscript review failed', new Error(result.message));
  logger.show();
  await showStoryboardFailure(`원고 최종 검사에 실패했습니다: ${result.message}`);
}
