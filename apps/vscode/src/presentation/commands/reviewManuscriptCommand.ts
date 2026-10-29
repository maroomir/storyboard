import { storyboardCommandIds } from '@/contributionIds';
import type { IExtensionCommand } from '@/presentation/commands/extensionCommand';
import * as vscode from 'vscode';

import type { ReviewManuscriptResult } from '@storyboard/story-engine';
import type { ManuscriptManager } from '@storyboard/story-app';
import type { IStoryboardLogger } from '@storyboard/story-engine';
import { resolveStoryboardWorkspaceRoot } from '@/infrastructure/vscode/workspace';
import { showStoryboardFailure } from '@/presentation/notifications/showStoryboardFailure';
import { storyboardMessages } from '@/presentation/notifications/storyboardMessages';

export interface ReviewManuscriptCommandDependencies {
  readonly logger: IStoryboardLogger;
  readonly manuscript: Pick<ManuscriptManager, 'review'>;
}

export class ReviewManuscriptCommand implements IExtensionCommand {
  public readonly id: string = storyboardCommandIds.manuscriptReview;

  public constructor(private readonly dependencies: ReviewManuscriptCommandDependencies) {}

  public async run(): Promise<void> {
    const workspaceRoot: vscode.Uri | undefined = await resolveStoryboardWorkspaceRoot();
    if (!workspaceRoot) {
      await vscode.window.showErrorMessage(storyboardMessages.missingWorkspace);
      return;
    }

    const manuscriptReview: ReviewManuscriptResult = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Storyboard 원고 최종 검사',
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: '연속성·비평 검사 중…' });
        return await this.dependencies.manuscript.review({ workspaceRoot });
      },
    );

    if (!manuscriptReview.ok) {
      await this.reportFailure(manuscriptReview);
      return;
    }

    const document: vscode.TextDocument = await vscode.workspace.openTextDocument(
      manuscriptReview.reportUri,
    );
    await vscode.window.showTextDocument(document);

    const total: number = manuscriptReview.continuityCount + manuscriptReview.critiqueCount;
    await vscode.window.showInformationMessage(
      total === 0
        ? '원고 최종 검사를 마쳤습니다. 발견된 이슈가 없습니다.'
        : `원고 최종 검사를 마쳤습니다. 설정 모순 ${manuscriptReview.continuityCount}건, 비평 ${manuscriptReview.critiqueCount}건.`,
    );
  }

  private async reportFailure(
    failure: Exclude<ReviewManuscriptResult, { readonly ok: true }>,
  ): Promise<void> {
    if (failure.kind === 'missing_outline') {
      await vscode.window.showWarningMessage(storyboardMessages.missingOutline);
      return;
    }
    if (failure.kind === 'missing_drafts') {
      await vscode.window.showInformationMessage(
        '검사할 초안이 없습니다. 먼저 Generate (All) Drafts를 실행해 주세요.',
      );
      return;
    }

    this.dependencies.logger.error('Manuscript review failed', new Error(failure.message));
    this.dependencies.logger.show();
    await showStoryboardFailure(`원고 최종 검사에 실패했습니다: ${failure.message}`);
  }
}
