import * as vscode from 'vscode';

import type { GenerateSceneBeatsUseCase } from '@storyboard/story-engine';
import { isDirectSceneCardFile } from '@storyboard/story-engine';
import { showStoryboardFailure } from '@/presentation/notifications/showStoryboardFailure';

const GENERATE_SCENE_BEATS_COMMAND = 'storyboard.scene.beats';

export interface RegisterGenerateSceneBeatsCommandDependencies {
  readonly generateSceneBeatsUseCase: GenerateSceneBeatsUseCase;
}

function resolveSceneUriFromInvocation(invokedUri?: vscode.Uri): vscode.Uri | undefined {
  if (invokedUri?.scheme === 'file') {
    return invokedUri;
  }

  const document = vscode.window.activeTextEditor?.document;
  return document?.uri.scheme === 'file' ? document.uri : undefined;
}

async function runCommand(
  invokedUri: vscode.Uri | undefined,
  dependencies: RegisterGenerateSceneBeatsCommandDependencies,
): Promise<void> {
  const sceneUri = resolveSceneUriFromInvocation(invokedUri);
  const workspaceFolder = sceneUri && vscode.workspace.getWorkspaceFolder(sceneUri);

  if (!sceneUri || !workspaceFolder || !isDirectSceneCardFile(sceneUri, workspaceFolder)) {
    await vscode.window.showErrorMessage(
      '씬 파일 URI가 없습니다. `scene` 폴더의 `.card` 파일을 열거나 탐색기에서 명령을 실행해 주세요.',
    );
    return;
  }

  const fileName = sceneUri.path.split('/').pop() ?? '';
  const request = {
    workspaceRoot: workspaceFolder.uri,
    sceneUri,
    fileName,
  };
  const kept = await dependencies.generateSceneBeatsUseCase.execute(request);
  if (!kept.ok) {
    void showStoryboardFailure(kept.message);
    return;
  }

  if (kept.kind === 'proposed') {
    void vscode.window.showInformationMessage(`비트 ${kept.beats.length}개를 카드에 썼습니다.`);
    return;
  }

  const overwriteLabel = '다시 뽑기';
  const choice = await vscode.window.showWarningMessage(
    `이미 비트 ${kept.beats.length}개가 있습니다. 다시 뽑아 덮어쓸까요?`,
    { modal: true },
    overwriteLabel,
  );
  if (choice !== overwriteLabel) {
    return;
  }

  const forced = await dependencies.generateSceneBeatsUseCase.execute({ ...request, force: true });
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
