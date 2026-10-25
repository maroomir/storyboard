import * as vscode from 'vscode';

import type { SummarizeChaptersResult } from '@storyboard/story-engine';
import type { ManuscriptManager } from '@storyboard/story-app';
import type { IStoryboardLogger } from '@storyboard/story-engine';
import { resolveStoryboardWorkspaceRoot } from '@/infrastructure/vscode/workspace';
import { showStoryboardFailure } from '@/presentation/notifications/showStoryboardFailure';
import { storyboardMessages } from '@/presentation/notifications/storyboardMessages';

const SUMMARIZE_CHAPTERS_COMMAND: string = 'storyboard.manuscript.summaries';

export type RegisterSummarizeChaptersCommandDependencies = {
  readonly logger: IStoryboardLogger;
  readonly manuscript: Pick<ManuscriptManager, 'summarizeChapters'>;
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
  const workspaceRoot: vscode.Uri | undefined = await resolveStoryboardWorkspaceRoot();
  if (!workspaceRoot) {
    await vscode.window.showErrorMessage(storyboardMessages.missingWorkspace);
    return;
  }

  const chapterSummaries: SummarizeChaptersResult = await vscode.window.withProgress(
    {
      cancellable: true,
      location: vscode.ProgressLocation.Notification,
      title: 'Storyboard 장별 요약',
    },
    async (progress, token) =>
      await dependencies.manuscript.summarizeChapters({
        workspaceRoot,
        onProgress: (current, total) =>
          progress.report({ message: `요약 중 (${current}/${total})…` }),
        shouldCancel: () => token.isCancellationRequested,
      }),
  );

  if (!chapterSummaries.ok) {
    await reportFailure(chapterSummaries, dependencies.logger);
    return;
  }

  const document: vscode.TextDocument = await vscode.workspace.openTextDocument(
    chapterSummaries.summaryUri,
  );
  await vscode.window.showTextDocument(document);
  await vscode.window.showInformationMessage(
    `장 ${chapterSummaries.summaryCount}개를 요약했습니다.`,
  );
}

async function reportFailure(
  failure: Exclude<SummarizeChaptersResult, { readonly ok: true }>,
  logger: IStoryboardLogger,
): Promise<void> {
  if (failure.kind === 'cancelled') return;
  if (failure.kind === 'missing_outline') {
    await vscode.window.showWarningMessage(storyboardMessages.missingOutline);
    return;
  }
  if (failure.kind === 'missing_drafts') {
    await vscode.window.showInformationMessage(
      '요약할 초안이 없습니다. 먼저 Generate (All) Drafts를 실행해 주세요.',
    );
    return;
  }

  logger.error('Chapter summarize failed', new Error(failure.message));
  logger.show();
  await showStoryboardFailure(`장별 요약에 실패했습니다: ${failure.message}`);
}
