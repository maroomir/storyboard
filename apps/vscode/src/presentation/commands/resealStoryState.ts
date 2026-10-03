import * as vscode from 'vscode';

import type { ConfigBridge } from '@storyboard/story-ai';
import type { IFileSystem, IStoryboardLogger } from '@storyboard/story-engine';
import {
  auditStoryMemory,
  getStoryboardProjectPaths,
  readProjectJson,
  resealStoryMemory,
} from '@storyboard/story-engine';
import { formatSceneOrderRanges } from '@storyboard/story-model';
import { getTargetWorkspaceFolder, hasStoryboardProject } from '@/infrastructure/vscode/workspace';
import { showStoryboardFailure } from '@/presentation/notifications/showStoryboardFailure';

const resealStoryStateCommand = 'storyboard.state.reseal';

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
  const workspaceFolder = await getTargetWorkspaceFolder();

  if (!workspaceFolder) {
    return;
  }

  if (!(await hasStoryboardProject(workspaceFolder))) {
    await vscode.window.showWarningMessage('Storyboard 프로젝트가 아닙니다.');
    return;
  }

  const { configBridge, fileSystem, logger } = dependencies;
  const paths = getStoryboardProjectPaths(workspaceFolder.uri);

  try {
    const project = await readProjectJson(fileSystem, paths.projectJson);
    const request = {
      fileSystem,
      paths,
      format: project.format,
      sceneBreakJoiner: configBridge.getDraftSceneBreakSeparator(),
    };
    const { audit } = await auditStoryMemory(request);

    if (audit.staleSceneOrders.length === 0) {
      await vscode.window.showInformationMessage('다시 봉인할 낡은 항목이 없습니다.');
      return;
    }

    // NOTE: 봉인은 낡음 판정을 지운다. 초안을 다시 만들지 않기로 한 판단이 맞는지는 사람만 알 수
    // 있으므로 되돌릴 수 없는 편집임을 알리고 확인을 받는다.
    const confirmed = await vscode.window.showWarningMessage(
      `씬 ${formatSceneOrderRanges(audit.staleSceneOrders)}의 항목 ${audit.staleEntryCount}개를 지금의 카드·씬 기준으로 다시 봉인합니다. 초안은 다시 만들지 않습니다.`,
      { modal: true },
      '다시 봉인',
    );

    if (confirmed === undefined) {
      return;
    }

    const resealed = await resealStoryMemory(request);

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
