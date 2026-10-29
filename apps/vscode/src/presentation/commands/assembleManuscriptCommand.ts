import { storyboardCommandIds } from '@/contributionIds';
import type { IExtensionCommand } from '@/presentation/commands/extensionCommand';
import * as vscode from 'vscode';

import type { AssembleManuscriptResult } from '@storyboard/story-engine';
import type { ManuscriptManager } from '@storyboard/story-app';
import type { IStoryboardLogger } from '@storyboard/story-engine';
import { resolveStoryboardWorkspaceRoot } from '@/infrastructure/vscode/workspace';
import { showStoryboardFailure } from '@/presentation/notifications/showStoryboardFailure';
import { storyboardMessages } from '@/presentation/notifications/storyboardMessages';

export type AssembleManuscriptCommandDependencies = {
  readonly manuscript: Pick<ManuscriptManager, 'assemble'>;
  readonly logger: IStoryboardLogger;
};

export class AssembleManuscriptCommand implements IExtensionCommand {
  public readonly id: string = storyboardCommandIds.manuscriptAssemble;

  public constructor(private readonly dependencies: AssembleManuscriptCommandDependencies) {}

  public run(): unknown {
    return runAssembleManuscript(this.dependencies);
  }
}

async function runAssembleManuscript(
  dependencies: AssembleManuscriptCommandDependencies,
): Promise<void> {
  const workspaceRoot: vscode.Uri | undefined = await resolveStoryboardWorkspaceRoot();
  if (!workspaceRoot) {
    await vscode.window.showErrorMessage(storyboardMessages.missingWorkspace);
    return;
  }

  const assembly: AssembleManuscriptResult = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: '원고 조립 중…' },
    () => dependencies.manuscript.assemble({ workspaceRoot }),
  );
  if (!assembly.ok) {
    await reportFailure(assembly, dependencies.logger);
    return;
  }

  const document: vscode.TextDocument = await vscode.workspace.openTextDocument(
    assembly.result.volumeUri,
  );
  await vscode.window.showTextDocument(document);
  await vscode.window.showInformationMessage(
    `원고를 조립했습니다. 챕터 ${assembly.result.chapterCount}개, 포함 ${assembly.result.includedCount}개, 누락 ${assembly.result.missingCount}개, 기타 ${assembly.result.extraCount}개, 복선 ${assembly.result.foreshadowingCount}건.`,
  );
}

async function reportFailure(
  failure: Exclude<AssembleManuscriptResult, { readonly ok: true }>,
  logger: IStoryboardLogger,
): Promise<void> {
  if (failure.kind === 'missing_outline') {
    await vscode.window.showWarningMessage(storyboardMessages.missingOutline);
    return;
  }
  if (failure.kind === 'missing_drafts') {
    await vscode.window.showInformationMessage(
      '조립할 초안이 없습니다. 먼저 Generate (All) Drafts를 실행해 주세요.',
    );
    return;
  }

  logger.error('Manuscript assembly failed', new Error(failure.message));
  logger.show();
  await showStoryboardFailure(`원고 조립에 실패했습니다: ${failure.message}`);
}
