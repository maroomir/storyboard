import { storyboardCommandIds } from '@/contributionIds';
import type { IExtensionCommand } from '@/presentation/commands/extensionCommand';
import * as vscode from 'vscode';

import {
  draftPath,
  parseSceneFileName,
  type SceneFileNameParts,
  type StoryUri,
} from '@storyboard/story-model';
import { hasStoryboardProject, uriExists } from '@/infrastructure/vscode/workspace';

export class OpenSceneDraftCommand implements IExtensionCommand {
  public readonly id: string = storyboardCommandIds.sceneOpenDraft;

  public async run(invokedUri?: vscode.Uri): Promise<void> {
    const sceneUri: vscode.Uri | undefined = this.resolveSceneUri(invokedUri);

    if (!sceneUri || sceneUri.scheme !== 'file') {
      await vscode.window.showErrorMessage(
        '씬 파일을 선택하거나 `scene` 폴더의 `.card` 파일을 연 뒤 다시 시도해 주세요.',
      );
      return;
    }

    const workspaceFolder: vscode.WorkspaceFolder | undefined =
      vscode.workspace.getWorkspaceFolder(sceneUri);

    if (!workspaceFolder || !(await hasStoryboardProject(workspaceFolder))) {
      await vscode.window.showWarningMessage('Storyboard 프로젝트가 아닙니다.');
      return;
    }

    const fileName: string = sceneUri.path.split('/').pop() ?? '';
    const parts: SceneFileNameParts | undefined = parseSceneFileName(fileName);

    if (!parts) {
      await vscode.window.showErrorMessage('씬 파일명은 `NN-slug.card` 형식이어야 합니다.');
      return;
    }

    const draftUri: StoryUri = draftPath(workspaceFolder.uri, parts.stem);

    if (!(await uriExists(draftUri))) {
      await vscode.window.showInformationMessage(
        '아직 이 씬에 대한 드래프트 파일이 없습니다. Generate Draft를 실행해 주세요.',
      );
      return;
    }

    const document: vscode.TextDocument = await vscode.workspace.openTextDocument(draftUri);
    await vscode.window.showTextDocument(document);
  }

  private resolveSceneUri(invokedUri?: vscode.Uri): vscode.Uri | undefined {
    if (invokedUri) {
      return invokedUri;
    }

    const activeUri: vscode.Uri | undefined = vscode.window.activeTextEditor?.document.uri;
    return activeUri ?? undefined;
  }
}
