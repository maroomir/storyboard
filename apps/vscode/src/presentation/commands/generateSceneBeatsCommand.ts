import { storyboardCommandIds } from '@/contributionIds';
import type { IExtensionCommand } from '@/presentation/commands/extensionCommand';
import * as vscode from 'vscode';

import type { DraftManager } from '@storyboard/story-app';
import { isDirectSceneCardFile } from '@storyboard/story-model';
import { showStoryboardFailure } from '@/presentation/notifications/showStoryboardFailure';
import { storyboardMessages } from '@/presentation/notifications/storyboardMessages';
import type { GenerateSceneBeatsRequest, GenerateSceneBeatsResult } from '@storyboard/story-engine';
import { resolveSceneUriFromInvocation } from '@/presentation/commands/sceneInvocation';

export interface GenerateSceneBeatsCommandDependencies {
  readonly drafts: Pick<DraftManager, 'generateBeats'>;
}

export class GenerateSceneBeatsCommand implements IExtensionCommand {
  public readonly id: string = storyboardCommandIds.sceneBeats;

  public constructor(private readonly dependencies: GenerateSceneBeatsCommandDependencies) {}

  public run(invokedUri?: vscode.Uri): Thenable<void> {
    return vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Storyboard 씬 비트 전개' },
      () => this.generateBeats(invokedUri),
    );
  }

  private async generateBeats(invokedUri: vscode.Uri | undefined): Promise<void> {
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
    const kept: GenerateSceneBeatsResult = await this.dependencies.drafts.generateBeats(request);
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

    const forced: GenerateSceneBeatsResult = await this.dependencies.drafts.generateBeats({
      ...request,
      force: true,
    });
    if (!forced.ok) {
      void showStoryboardFailure(forced.message);
      return;
    }
    void vscode.window.showInformationMessage(`비트 ${forced.beats.length}개를 다시 썼습니다.`);
  }
}
