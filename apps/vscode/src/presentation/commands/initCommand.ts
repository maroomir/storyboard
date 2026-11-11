import { storyboardCommandIds } from '@/contributionIds';
import type { IExtensionCommand } from '@/presentation/commands/extensionCommand';
import type { CreateWorkspaceResult } from '@storyboard/story-engine';
import type { WorkspaceManager } from '@storyboard/story-app';
import * as vscode from 'vscode';

import type { IStoryboardLogger } from '@storyboard/story-engine';
import { refreshStoryboardWorkspaceContext } from '@/infrastructure/vscode/storyboardWorkspaceContext';
import { getStoryboardProjectPaths, type StoryboardProjectPaths } from '@storyboard/story-model';
import {
  ensureUriDoesNotExist,
  getTargetWorkspaceFolder,
  uriExists,
} from '@/infrastructure/vscode/workspace';

export interface InitCommandDependencies {
  readonly logger: IStoryboardLogger;
  readonly workspace: Pick<WorkspaceManager, 'create'>;
}

export class InitCommand implements IExtensionCommand {
  public readonly id: string = storyboardCommandIds.init;

  public constructor(private readonly dependencies: InitCommandDependencies) {}

  public async run(): Promise<void> {
    const workspaceFolder: vscode.WorkspaceFolder | undefined = await getTargetWorkspaceFolder();

    if (!workspaceFolder) {
      return;
    }

    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceFolder.uri);

    try {
      if (!(await this.validateCanInitialize(paths))) {
        return;
      }

      const { project }: CreateWorkspaceResult = await this.dependencies.workspace.create({
        workspaceRoot: workspaceFolder.uri,
        name: workspaceFolder.name,
      });

      this.dependencies.logger.info(
        `Initialized Storyboard project at ${workspaceFolder.uri.fsPath}`,
      );
      await refreshStoryboardWorkspaceContext();
      await vscode.window.showInformationMessage(
        `Storyboard 프로젝트를 초기화했습니다: ${project.name}`,
      );
    } catch (error) {
      this.dependencies.logger.error('Failed to initialize Storyboard project', error);
      this.dependencies.logger.show();
      await vscode.window.showErrorMessage(
        'Storyboard 프로젝트 초기화에 실패했습니다. Output 패널을 확인해 주세요.',
      );
    }
  }

  private async validateCanInitialize(paths: StoryboardProjectPaths): Promise<boolean> {
    if (await uriExists(paths.projectJson)) {
      await vscode.window.showInformationMessage('이미 Storyboard 프로젝트로 초기화된 폴더입니다.');
      return false;
    }

    return ensureUriDoesNotExist(
      paths.metadataDirectory,
      '`.storyboard` 폴더가 이미 있지만 `project.json`은 없습니다. 안전을 위해 초기화를 중단합니다.',
    );
  }
}
