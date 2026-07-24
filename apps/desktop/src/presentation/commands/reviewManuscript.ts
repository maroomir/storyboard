import * as vscode from 'vscode';

import type { ReviewManuscriptUseCase } from '../../application/manuscript/reviewManuscriptUseCase';
import type { StoryboardLogger } from '../../infrastructure/vscode/logger';
import { resolveStoryboardWorkspaceRoot } from '../../infrastructure/vscode/workspace';

const reviewManuscriptCommand = 'storyboard.manuscript.review';

export interface RegisterReviewManuscriptCommandDependencies {
  readonly logger: StoryboardLogger;
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
    await vscode.window.showErrorMessage(
      'Storyboard 프로젝트(.storyboard/project.json)가 없습니다. 먼저 초기화해 주세요.',
    );
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
      return await dependencies.reviewManuscriptUseCase.execute(workspaceRoot);
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
  logger: StoryboardLogger,
): Promise<void> {
  if (result.kind === 'missing_outline') {
    await vscode.window.showWarningMessage(
      '아웃라인(chapters.yaml)이 없습니다. 먼저 Generate Novel Outline을 실행해 주세요.',
    );
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
  await vscode.window.showErrorMessage(`원고 최종 검사에 실패했습니다: ${result.message}`);
}
