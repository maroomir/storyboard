import * as vscode from 'vscode';

import type { ConfigBridge } from '@storyboard/story-ai';
import type {
  IFileSystem,
  IStoryboardLogger,
  StoryStateAuditRequest,
} from '@storyboard/story-engine';
import { StoryMemoryAuditor, ProjectRepository } from '@storyboard/story-engine';
import {
  getStoryboardProjectPaths,
  formatSceneOrderRanges,
  type StoryboardProjectPaths,
  type StoryboardProject,
} from '@storyboard/story-model';
import { getTargetWorkspaceFolder, hasStoryboardProject } from '@/infrastructure/vscode/workspace';
import { showStoryboardFailure } from '@/presentation/notifications/showStoryboardFailure';

const resealStoryStateCommand: string = 'storyboard.state.reseal';

export type RegisterResealStoryStateCommandDependencies = {
  readonly configBridge: ConfigBridge;
  readonly fileSystem: IFileSystem;
  readonly logger: IStoryboardLogger;
};

export function registerResealStoryStateCommand(
  dependencies: RegisterResealStoryStateCommandDependencies,
): vscode.Disposable {
  return vscode.commands.registerCommand(resealStoryStateCommand, () => runReseal(dependencies));
}

async function runReseal(dependencies: RegisterResealStoryStateCommandDependencies): Promise<void> {
  const workspaceFolder: vscode.WorkspaceFolder | undefined = await getTargetWorkspaceFolder();

  if (!workspaceFolder) {
    return;
  }

  if (!(await hasStoryboardProject(workspaceFolder))) {
    await vscode.window.showWarningMessage('Storyboard 프로젝트가 아닙니다.');
    return;
  }

  const { configBridge, fileSystem, logger } = dependencies;
  const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceFolder.uri);

  try {
    const project: StoryboardProject = await new ProjectRepository(fileSystem).read(
      paths.projectJson,
    );
    const request: StoryStateAuditRequest = {
      fileSystem,
      paths,
      format: project.format,
      sceneBreakJoiner: configBridge.getDraftSceneBreakSeparator(),
    };
    const auditor: StoryMemoryAuditor = new StoryMemoryAuditor(request);
    const { audit } = await auditor.audit();

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

    const resealed: readonly number[] = await auditor.reseal();

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
