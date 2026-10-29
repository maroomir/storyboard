import { storyboardCommandIds } from '@/contributionIds';
import type { IExtensionCommand } from '@/presentation/commands/extensionCommand';
import { ProjectRepository } from '@storyboard/story-engine';
import { vscodeFileSystem } from '@/infrastructure/vscode/vscodeFileSystem';
import * as vscode from 'vscode';

import {
  getStoryboardProjectPaths,
  sceneFilePath,
  serializeSceneCard,
  resolveScenePrefixDigitCount,
  type StoryUri,
  type StoryboardProjectPaths,
  type StoryboardProject,
} from '@storyboard/story-model';
import { getTargetWorkspaceFolder, uriExists } from '@/infrastructure/vscode/workspace';
import {
  computeNextSceneOrderFromSceneFileNames,
  formatSceneOrderPrefix,
  validateSceneSlugInput,
} from '@/presentation/commands/newSceneHelpers';
import type { ConfigBridge } from '@storyboard/story-ai';

export interface CreateSceneCommandDependencies {
  readonly configBridge: ConfigBridge;
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

    const prefix: string = await this.resolveNextScenePrefix(paths);

    const slug: string | undefined = await vscode.window.showInputBox({
      title: '새 씬 슬러그',
      prompt: `파일명: ${prefix}-<slug>.card`,
      ignoreFocusOut: true,
      validateInput: validateSceneSlugInput,
    });

    if (!slug) {
      return;
    }

    const normalizedSlug: string = slug.trim();
    const sceneUri: StoryUri = sceneFilePath(workspaceFolder.uri, prefix, normalizedSlug);

    if (await uriExists(sceneUri)) {
      await vscode.window.showWarningMessage('이미 같은 이름의 씬 파일이 있습니다.');
      return;
    }

    const emptySceneCard: string = serializeSceneCard({
      type: 'scene',
      id: `${prefix}-${normalizedSlug}`,
    });
    await vscode.workspace.fs.writeFile(sceneUri, new TextEncoder().encode(emptySceneCard));

    const document: vscode.TextDocument = await vscode.workspace.openTextDocument(sceneUri);
    await vscode.window.showTextDocument(document);
  }

  private async resolveNextScenePrefix(paths: StoryboardProjectPaths): Promise<string> {
    const project: StoryboardProject = await new ProjectRepository(vscodeFileSystem).read(
      paths.projectJson,
    );
    const digitCount: number = resolveScenePrefixDigitCount(
      project.editor.scenePrefixDigits,
      this.dependencies.configBridge.inspectScenePrefixDigits(),
    );

    const directoryEntries: [string, vscode.FileType][] = await vscode.workspace.fs.readDirectory(
      paths.sceneDirectory,
    );
    const sceneFileNames: string[] = directoryEntries
      .filter(([, fileType]) => fileType === vscode.FileType.File)
      .map(([name]) => name);

    const nextOrder: number = computeNextSceneOrderFromSceneFileNames(sceneFileNames);
    return formatSceneOrderPrefix(nextOrder, digitCount);
  }
}
