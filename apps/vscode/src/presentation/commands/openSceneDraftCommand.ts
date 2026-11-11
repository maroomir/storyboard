import { storyboardCommandIds } from '@/contributionIds';
import type { IExtensionCommand } from '@/presentation/commands/extensionCommand';
import * as vscode from 'vscode';

import { draftPath, type StoryUri } from '@storyboard/story-model';
import { hasStoryboardProject, uriExists } from '@/infrastructure/vscode/workspace';
import {
  resolveSceneBundleTarget,
  resolveSceneUriFromInvocation,
  type SceneBundleTarget,
} from '@/presentation/commands/sceneInvocation';

export class OpenSceneDraftCommand implements IExtensionCommand {
  public readonly id: string = storyboardCommandIds.sceneOpenDraft;

  public async run(invokedUri?: vscode.Uri): Promise<void> {
    const sceneUri: vscode.Uri | undefined = resolveSceneUriFromInvocation(invokedUri);

    if (!sceneUri) {
      await vscode.window.showErrorMessage(
        '씬을 선택하거나 `scene` 폴더의 씬 카드를 연 뒤 다시 시도해 주세요.',
      );
      return;
    }

    const workspaceFolder: vscode.WorkspaceFolder | undefined =
      vscode.workspace.getWorkspaceFolder(sceneUri);

    if (!workspaceFolder || !(await hasStoryboardProject(workspaceFolder))) {
      await vscode.window.showWarningMessage('Storyboard 프로젝트가 아닙니다.');
      return;
    }

    const target: SceneBundleTarget | undefined = resolveSceneBundleTarget(sceneUri);

    if (!target) {
      await vscode.window.showErrorMessage('씬은 `scene/NNN-slug.card` 폴더여야 합니다.');
      return;
    }

    const draftUri: StoryUri = draftPath(workspaceFolder.uri, target.stem);

    if (!(await uriExists(draftUri))) {
      await vscode.window.showInformationMessage(
        '아직 이 씬에 대한 드래프트 파일이 없습니다. Generate Draft를 실행해 주세요.',
      );
      return;
    }

    const document: vscode.TextDocument = await vscode.workspace.openTextDocument(draftUri);
    await vscode.window.showTextDocument(document);
  }
}
