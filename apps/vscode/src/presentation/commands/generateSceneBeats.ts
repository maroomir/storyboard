import * as vscode from 'vscode';

import type { DraftManager } from '@storyboard/story-app';
import { isDirectSceneCardFile } from '@storyboard/story-model';
import { showStoryboardFailure } from '@/presentation/notifications/showStoryboardFailure';
import { storyboardMessages } from '@/presentation/notifications/storyboardMessages';
import type { GenerateSceneBeatsRequest, GenerateSceneBeatsResult } from '@storyboard/story-engine';

const GENERATE_SCENE_BEATS_COMMAND: string = 'storyboard.scene.beats';

export interface RegisterGenerateSceneBeatsCommandDependencies {
  readonly drafts: Pick<DraftManager, 'generateBeats'>;
}

function resolveSceneUriFromInvocation(invokedUri?: vscode.Uri): vscode.Uri | undefined {
  if (invokedUri?.scheme === 'file') {
    return invokedUri;
  }

  const document: vscode.TextDocument | undefined = vscode.window.activeTextEditor?.document;
  return document?.uri.scheme === 'file' ? document.uri : undefined;
}

async function runCommand(
  invokedUri: vscode.Uri | undefined,
  dependencies: RegisterGenerateSceneBeatsCommandDependencies,
): Promise<void> {
  const sceneUri: vscode.Uri | undefined = resolveSceneUriFromInvocation(invokedUri);
  const workspaceFolder: vscode.WorkspaceFolder | undefined =
    sceneUri && vscode.workspace.getWorkspaceFolder(sceneUri);

  if (!sceneUri || !workspaceFolder || !isDirectSceneCardFile(sceneUri, workspaceFolder)) {
    await vscode.window.showErrorMessage(storyboardMessages.missingSceneUri);
    return;
  }

  const fileName: string = sceneUri.path.split('/').pop() ?? '';
  const request: GenerateSceneBeatsRequest = {
    workspaceRoot: workspaceFolder.uri,
    sceneUri,
    fileName,
  };
  const kept: GenerateSceneBeatsResult = await dependencies.drafts.generateBeats(request);
  if (!kept.ok) {
    void showStoryboardFailure(kept.message);
    return;
  }

  if (kept.kind === 'proposed') {
    void vscode.window.showInformationMessage(`비트 ${kept.beats.length}개를 카드에 썼습니다.`);
    return;
  }

  const overwriteLabel: string = '다시 뽑기';
  const choice: string | undefined = await vscode.window.showWarningMessage(
    `이미 비트 ${kept.beats.length}개가 있습니다. 다시 뽑아 덮어쓸까요?`,
    { modal: true },
    overwriteLabel,
  );
  if (choice !== overwriteLabel) {
    return;
  }

  const forced: GenerateSceneBeatsResult = await dependencies.drafts.generateBeats({
    ...request,
    force: true,
  });
  if (!forced.ok) {
    void showStoryboardFailure(forced.message);
    return;
  }
  void vscode.window.showInformationMessage(`비트 ${forced.beats.length}개를 다시 썼습니다.`);
}

export function registerGenerateSceneBeatsCommand(
  dependencies: RegisterGenerateSceneBeatsCommandDependencies,
): vscode.Disposable {
  return vscode.commands.registerCommand(GENERATE_SCENE_BEATS_COMMAND, (invokedUri?: vscode.Uri) =>
    vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Storyboard 씬 비트 전개' },
      () => runCommand(invokedUri, dependencies),
    ),
  );
}
