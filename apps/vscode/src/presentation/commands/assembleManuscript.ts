import * as vscode from 'vscode';

import type { AssembleManuscriptUseCase } from '@storyboard/story-engine';
import type { IStoryboardLogger } from '@storyboard/story-engine';
import { resolveStoryboardWorkspaceRoot } from '@/infrastructure/vscode/workspace';
import { showStoryboardFailure } from '@/presentation/notifications/showStoryboardFailure';

const ASSEMBLE_MANUSCRIPT_COMMAND = 'storyboard.manuscript.assemble';

export type RegisterAssembleManuscriptCommandDependencies = {
  readonly assembleManuscriptUseCase: AssembleManuscriptUseCase;
  readonly logger: IStoryboardLogger;
};

export function registerAssembleManuscriptCommand(
  dependencies: RegisterAssembleManuscriptCommandDependencies,
): vscode.Disposable {
  return vscode.commands.registerCommand(ASSEMBLE_MANUSCRIPT_COMMAND, () =>
    runAssembleManuscript(dependencies),
  );
}

async function runAssembleManuscript(
  dependencies: RegisterAssembleManuscriptCommandDependencies,
): Promise<void> {
  const workspaceRoot = await resolveStoryboardWorkspaceRoot();
  if (!workspaceRoot) {
    await vscode.window.showErrorMessage(
      'Storyboard 프로젝트(.storyboard/project.json)가 없습니다. 먼저 초기화해 주세요.',
    );
    return;
  }

  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: '원고 조립 중…' },
    () => dependencies.assembleManuscriptUseCase.execute(workspaceRoot),
  );
  if (!result.ok) {
    await reportFailure(result, dependencies.logger);
    return;
  }

  const document = await vscode.workspace.openTextDocument(result.result.volumeUri);
  await vscode.window.showTextDocument(document);
  await vscode.window.showInformationMessage(
    `원고를 조립했습니다. 챕터 ${result.result.chapterCount}개, 포함 ${result.result.includedCount}개, 누락 ${result.result.missingCount}개, 기타 ${result.result.extraCount}개, 복선 ${result.result.foreshadowingCount}건.`,
  );
}

async function reportFailure(
  result: Exclude<Awaited<ReturnType<AssembleManuscriptUseCase['execute']>>, { readonly ok: true }>,
  logger: IStoryboardLogger,
): Promise<void> {
  if (result.kind === 'missing_outline') {
    await vscode.window.showWarningMessage(
      '아웃라인(chapters.yaml)이 없습니다. 먼저 Generate Novel Outline을 실행해 주세요.',
    );
    return;
  }
  if (result.kind === 'missing_drafts') {
    await vscode.window.showInformationMessage(
      '조립할 초안이 없습니다. 먼저 Generate (All) Drafts를 실행해 주세요.',
    );
    return;
  }

  logger.error('Manuscript assembly failed', new Error(result.message));
  logger.show();
  await showStoryboardFailure(`원고 조립에 실패했습니다: ${result.message}`);
}
