import { storyboardCommandIds } from '@/contributionIds';
import type { IExtensionCommand } from '@/presentation/commands/extensionCommand';
import * as vscode from 'vscode';

import { getStoryboardProjectPaths, type StoryboardProjectPaths } from '@storyboard/story-model';
import { getTargetWorkspaceFolder, uriExists } from '@/infrastructure/vscode/workspace';
import type { StudioLauncher } from '@/presentation/providers/studioLauncher';

export interface CreateSceneCommandDependencies {
  readonly launcher: Pick<StudioLauncher, 'requestCreate'>;
}

export class CreateSceneCommand implements IExtensionCommand {
  public readonly id: string = storyboardCommandIds.sceneCreate;

  public constructor(private readonly dependencies: CreateSceneCommandDependencies) {}

  public async run(): Promise<void> {
    const workspaceFolder: vscode.WorkspaceFolder | undefined = await getTargetWorkspaceFolder();

    if (!workspaceFolder) {
      return;
    }

    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceFolder.uri);

    if (!(await uriExists(paths.projectJson))) {
      await vscode.window.showWarningMessage(
        'Storyboard 프로젝트가 아닙니다. 먼저 Initialize Project를 실행해 주세요.',
      );
      return;
    }

    await this.dependencies.launcher.requestCreate('scene');
  }
}
