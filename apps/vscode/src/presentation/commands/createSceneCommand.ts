import type { DraftManager } from '@storyboard/story-app';
import type { CreateSceneResult } from '@storyboard/story-engine';
import { storyboardCommandIds } from '@/contributionIds';
import type { IExtensionCommand } from '@/presentation/commands/extensionCommand';
import * as vscode from 'vscode';

import {
  getStoryboardProjectPaths,
  sceneCardPath,
  type StoryboardProjectPaths,
} from '@storyboard/story-model';
import { getTargetWorkspaceFolder, uriExists } from '@/infrastructure/vscode/workspace';
import { validateSceneSlugInput } from '@/presentation/commands/newSceneHelpers';

export interface CreateSceneCommandDependencies {
  readonly drafts: Pick<DraftManager, 'createScene'>;
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

    const slug: string | undefined = await vscode.window.showInputBox({
      title: '새 씬 슬러그',
      prompt: '씬은 맨 뒤 번호로 scene/<번호>-<slug>.card 에 만들어집니다.',
      ignoreFocusOut: true,
      validateInput: validateSceneSlugInput,
    });

    if (!slug) {
      return;
    }

    const created: CreateSceneResult = await this.dependencies.drafts.createScene({
      workspaceRoot: workspaceFolder.uri,
      slug: slug.trim(),
    });

    if (!created.ok) {
      await vscode.window.showWarningMessage(created.message);
      return;
    }

    const document: vscode.TextDocument = await vscode.workspace.openTextDocument(
      sceneCardPath(workspaceFolder.uri, created.stem) as vscode.Uri,
    );
    await vscode.window.showTextDocument(document);
  }
}
