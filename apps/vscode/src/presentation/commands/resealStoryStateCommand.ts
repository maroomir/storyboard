import { storyboardCommandIds } from '@/contributionIds';
import type { IExtensionCommand } from '@/presentation/commands/extensionCommand';
import * as vscode from 'vscode';

import type { IStoryboardLogger, StoryMemoryAudit } from '@storyboard/story-engine';
import type { WorkspaceManager } from '@storyboard/story-app';
import { formatSceneOrderRanges } from '@storyboard/story-model';
import { getTargetWorkspaceFolder, hasStoryboardProject } from '@/infrastructure/vscode/workspace';
import { showStoryboardFailure } from '@/presentation/notifications/showStoryboardFailure';

export type ResealStoryStateCommandDependencies = {
  readonly workspace: Pick<WorkspaceManager, 'auditStoryState' | 'resealStoryState'>;
  readonly logger: IStoryboardLogger;
};

export class ResealStoryStateCommand implements IExtensionCommand {
  public readonly id: string = storyboardCommandIds.stateReseal;

  public constructor(private readonly dependencies: ResealStoryStateCommandDependencies) {}

  public async run(): Promise<void> {
    const workspaceFolder: vscode.WorkspaceFolder | undefined = await getTargetWorkspaceFolder();

    if (!workspaceFolder) {
      return;
    }

    if (!(await hasStoryboardProject(workspaceFolder))) {
      await vscode.window.showWarningMessage('Storyboard 프로젝트가 아닙니다.');
      return;
    }

    const { workspace, logger } = this.dependencies;

    try {
      const { audit }: StoryMemoryAudit = await workspace.auditStoryState(workspaceFolder.uri);

      if (audit.staleSceneOrders.length === 0) {
        await vscode.window.showInformationMessage('다시 봉인할 낡은 항목이 없습니다.');
        return;
      }

      const confirmed: '다시 봉인' | undefined = await vscode.window.showWarningMessage(
        `씬 ${formatSceneOrderRanges(audit.staleSceneOrders)}의 항목 ${audit.staleEntryCount}개를 지금의 카드·씬 기준으로 다시 봉인합니다. 초안은 다시 만들지 않습니다.`,
        { modal: true },
        '다시 봉인',
      );

      if (confirmed === undefined) {
        return;
      }

      const resealed: readonly number[] = await workspace.resealStoryState(workspaceFolder.uri);

      await vscode.window.showInformationMessage(
        `씬 ${formatSceneOrderRanges(resealed)}의 원장 항목을 다시 봉인했습니다.`,
      );
    } catch (error) {
      logger.error(
        'Story state reseal failed',
        error instanceof Error ? error : new Error(String(error)),
      );
      logger.show();
      await showStoryboardFailure('이야기 상태 원장을 다시 봉인하지 못했습니다.');
    }
  }
}
