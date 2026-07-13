import * as vscode from 'vscode';

import type {
  GenerateAllDraftsProgress,
  GenerateAllDraftsSummary,
  GenerateAllDraftsUseCase,
} from '../application/drafts/generateAllDraftsUseCase';
import type { StoryboardLogger } from '../infrastructure/vscode/logger';
import { stageProgressLabel } from './generateDraft';

const GENERATE_ALL_DRAFTS_COMMAND = 'storyboard.draft.generateAll';

export type RegisterGenerateAllDraftsCommandDependencies = {
  readonly generateAllDraftsUseCase: GenerateAllDraftsUseCase;
  readonly logger: StoryboardLogger;
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
  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Storyboard 전체 초안 생성',
      cancellable: true,
    },
    async (progress, token) =>
      await dependencies.generateAllDraftsUseCase.execute({
        onProgress: (event) => progress.report({ message: formatProgress(event) }),
        shouldCancel: () => token.isCancellationRequested,
      }),
  );

  if (!result.ok) {
    if (result.kind === 'no_projects') {
      await vscode.window.showErrorMessage(
        'Storyboard 프로젝트(.storyboard/project.json)가 있는 워크스페이스 폴더가 없습니다.',
      );
    } else {
      await vscode.window.showInformationMessage('처리할 `scene/*.txt` 파일이 없습니다.');
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
  logger: StoryboardLogger,
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
