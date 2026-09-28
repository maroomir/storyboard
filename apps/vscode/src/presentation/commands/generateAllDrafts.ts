import * as vscode from 'vscode';

import type { GenerateAllDraftsProgress, GenerateAllDraftsSummary } from '@storyboard/story-engine';
import type { DraftManager } from '@storyboard/story-app';
import type { IFileSystem, IStoryboardLogger } from '@storyboard/story-engine';
import { resolveStoryboardWorkspaceRoot } from '@/infrastructure/vscode/workspace';
import { stageProgressLabel } from './generateDraft';
import { storyboardMessages } from '@/presentation/notifications/storyboardMessages';
import { runHoldingWorkspaceLock } from './workspaceRunLock';

const GENERATE_ALL_DRAFTS_COMMAND = 'storyboard.draft.generateAll';

export type RegisterGenerateAllDraftsCommandDependencies = {
  readonly fileSystem: IFileSystem;
  readonly drafts: Pick<DraftManager, 'generateAll'>;
  readonly logger: IStoryboardLogger;
};

export function registerGenerateAllDraftsCommand(
  dependencies: RegisterGenerateAllDraftsCommandDependencies,
): vscode.Disposable {
  return vscode.commands.registerCommand(GENERATE_ALL_DRAFTS_COMMAND, () =>
    runGenerateAllDrafts(dependencies),
  );
}

async function runGenerateAllDrafts(
  dependencies: RegisterGenerateAllDraftsCommandDependencies,
): Promise<void> {
  const workspaceRoot = await resolveStoryboardWorkspaceRoot();

  if (!workspaceRoot) {
    await vscode.window.showErrorMessage(storyboardMessages.missingWorkspaceFolder);
    return;
  }

  await runHoldingWorkspaceLock(dependencies.fileSystem, workspaceRoot, '전체 초안 생성', () =>
    generateAllDraftsWithProgress(dependencies),
  );
}

async function generateAllDraftsWithProgress(
  dependencies: RegisterGenerateAllDraftsCommandDependencies,
): Promise<void> {
  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Storyboard 전체 초안 생성',
      cancellable: true,
    },
    async (progress, token) =>
      await dependencies.drafts.generateAll({
        onProgress: (event) => progress.report({ message: formatProgress(event) }),
        shouldCancel: () => token.isCancellationRequested,
      }),
  );

  if (!result.ok) {
    if (result.kind === 'no_projects') {
      await vscode.window.showErrorMessage(storyboardMessages.missingWorkspaceFolder);
    } else {
      await vscode.window.showInformationMessage('처리할 `scene/*.card` 파일이 없습니다.');
    }
    return;
  }

  await reportSummary(result.summary, dependencies.logger);
}

function formatProgress(event: GenerateAllDraftsProgress): string {
  const prefix = `[${event.current}/${event.total}] ${event.label}`;
  if (event.kind === 'prepared') return `${prefix} — 준비 중…`;
  if (event.kind === 'saving') return `${prefix} — 저장 중…`;
  if (event.kind === 'revising') return `${prefix} — 검수·재작성 중…`;
  const label = event.stage ? stageProgressLabel(event.stage) : '처리 중';
  const suffix =
    event.stageTotal && event.stageTotal > 1 ? ` (${event.stageCurrent}/${event.stageTotal})` : '';
  return `${prefix} — ${label}${suffix}…`;
}

async function reportSummary(
  summary: GenerateAllDraftsSummary,
  logger: IStoryboardLogger,
): Promise<void> {
  const parts = [
    `총 ${summary.sceneCount}개 씬 중 생성 ${summary.generated}건, 캐시 재사용 ${summary.cacheHits}건`,
  ];
  if (summary.failures > 0) parts.push(`실패 ${summary.failures}건`);
  const text = parts.join(' · ');
  if (summary.failures > 0) {
    await vscode.window.showWarningMessage(
      summary.failureLabels.length > 0 ? `${text}\n\n${summary.failureLabels.join('\n')}` : text,
      { modal: false },
    );
    logger.show();
    return;
  }
  await vscode.window.showInformationMessage(text);
}
