import * as vscode from 'vscode';

import type { SummarizeChaptersUseCase } from '@storyboard/story-engine';
import type { IStoryboardLogger } from '@storyboard/story-engine';
import { resolveStoryboardWorkspaceRoot } from '../../infrastructure/vscode/workspace';

const SUMMARIZE_CHAPTERS_COMMAND = 'storyboard.manuscript.summaries';

export type RegisterSummarizeChaptersCommandDependencies = {
  readonly logger: IStoryboardLogger;
  readonly summarizeChaptersUseCase: SummarizeChaptersUseCase;
};

export function registerSummarizeChaptersCommand(
  dependencies: RegisterSummarizeChaptersCommandDependencies,
): vscode.Disposable {
  return vscode.commands.registerCommand(SUMMARIZE_CHAPTERS_COMMAND, () =>
    runSummarizeChapters(dependencies),
  );
}

async function runSummarizeChapters(
  dependencies: RegisterSummarizeChaptersCommandDependencies,
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
      cancellable: true,
      location: vscode.ProgressLocation.Notification,
      title: 'Storyboard 장별 요약',
    },
    async (progress, token) =>
      await dependencies.summarizeChaptersUseCase.execute(workspaceRoot, {
        onProgress: (current, total) =>
          progress.report({ message: `요약 중 (${current}/${total})…` }),
        shouldCancel: () => token.isCancellationRequested,
      }),
  );

  if (!result.ok) {
    await reportFailure(result, dependencies.logger);
    return;
  }

  const document = await vscode.workspace.openTextDocument(result.summaryUri);
  await vscode.window.showTextDocument(document);
  await vscode.window.showInformationMessage(`장 ${result.summaryCount}개를 요약했습니다.`);
}

async function reportFailure(
  result: Exclude<Awaited<ReturnType<SummarizeChaptersUseCase['execute']>>, { readonly ok: true }>,
  logger: IStoryboardLogger,
): Promise<void> {
  if (result.kind === 'cancelled') return;
  if (result.kind === 'missing_outline') {
    await vscode.window.showWarningMessage(
      '아웃라인(chapters.yaml)이 없습니다. 먼저 Generate Novel Outline을 실행해 주세요.',
    );
    return;
  }
  if (result.kind === 'missing_drafts') {
    await vscode.window.showInformationMessage(
      '요약할 초안이 없습니다. 먼저 Generate (All) Drafts를 실행해 주세요.',
    );
    return;
  }

  logger.error('Chapter summarize failed', new Error(result.message));
  logger.show();
  await vscode.window.showErrorMessage(`장별 요약에 실패했습니다: ${result.message}`);
}
