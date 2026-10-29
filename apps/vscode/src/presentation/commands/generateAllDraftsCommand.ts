import { storyboardCommandIds } from '@/contributionIds';
import type { IExtensionCommand } from '@/presentation/commands/extensionCommand';
import * as vscode from 'vscode';

import type {
  GenerateAllDraftsProgress,
  GenerateAllDraftsResult,
  GenerateAllDraftsSummary,
} from '@storyboard/story-engine';
import type { DraftManager, RunGate } from '@storyboard/story-app';
import type { IStoryboardLogger } from '@storyboard/story-engine';
import { resolveStoryboardWorkspaceRoot } from '@/infrastructure/vscode/workspace';
import { stageProgressLabel } from './generateDraft';
import { storyboardMessages } from '@/presentation/notifications/storyboardMessages';
import { runHoldingWorkspaceLock } from './workspaceRunLock';

export type GenerateAllDraftsCommandDependencies = {
  readonly runGate: Pick<RunGate, 'hold'>;
  readonly drafts: Pick<DraftManager, 'generateAll'>;
  readonly logger: IStoryboardLogger;
};

export class GenerateAllDraftsCommand implements IExtensionCommand {
  public readonly id: string = storyboardCommandIds.draftGenerateAll;

  public constructor(private readonly dependencies: GenerateAllDraftsCommandDependencies) {}

  public async run(): Promise<void> {
    const workspaceRoot: vscode.Uri | undefined = await resolveStoryboardWorkspaceRoot();

    if (!workspaceRoot) {
      await vscode.window.showErrorMessage(storyboardMessages.missingWorkspaceFolder);
      return;
    }

    await runHoldingWorkspaceLock(this.dependencies.runGate, workspaceRoot, '전체 초안 생성', () =>
      this.generateAllDraftsWithProgress(),
    );
  }

  private async generateAllDraftsWithProgress(): Promise<void> {
    const batchGeneration: GenerateAllDraftsResult = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Storyboard 전체 초안 생성',
        cancellable: true,
      },
      async (progress, token) =>
        await this.dependencies.drafts.generateAll({
          onProgress: (event) => progress.report({ message: formatProgress(event) }),
          shouldCancel: () => token.isCancellationRequested,
        }),
    );

    if (!batchGeneration.ok) {
      if (batchGeneration.kind === 'no_projects') {
        await vscode.window.showErrorMessage(storyboardMessages.missingWorkspaceFolder);
      } else {
        await vscode.window.showInformationMessage('처리할 `scene/*.card` 파일이 없습니다.');
      }
      return;
    }

    await this.reportSummary(batchGeneration.summary);
  }

  private async reportSummary(summary: GenerateAllDraftsSummary): Promise<void> {
    const parts: string[] = [
      `총 ${summary.sceneCount}개 씬 중 생성 ${summary.generated}건, 캐시 재사용 ${summary.cacheHits}건`,
    ];
    if (summary.failures > 0) parts.push(`실패 ${summary.failures}건`);
    const text: string = parts.join(' · ');
    if (summary.failures > 0) {
      await vscode.window.showWarningMessage(
        summary.failureLabels.length > 0 ? `${text}\n\n${summary.failureLabels.join('\n')}` : text,
        { modal: false },
      );
      this.dependencies.logger.show();
      return;
    }
    await vscode.window.showInformationMessage(text);
  }
}

function formatProgress(event: GenerateAllDraftsProgress): string {
  const prefix: string = `[${event.current}/${event.total}] ${event.label}`;
  if (event.kind === 'prepared') return `${prefix} — 준비 중…`;
  if (event.kind === 'saving') return `${prefix} — 저장 중…`;
  if (event.kind === 'revising') return `${prefix} — 검수·재작성 중…`;
  const label: string = event.stage ? stageProgressLabel(event.stage) : '처리 중';
  const suffix: string =
    event.stageTotal && event.stageTotal > 1 ? ` (${event.stageCurrent}/${event.stageTotal})` : '';
  return `${prefix} — ${label}${suffix}…`;
}
