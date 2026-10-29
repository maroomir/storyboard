import { storyboardCommandIds } from '@/contributionIds';
import type { IExtensionCommand } from '@/presentation/commands/extensionCommand';
import * as vscode from 'vscode';

import type { ApplyDraftFormatResult } from '@storyboard/story-engine';
import type { DraftManager } from '@storyboard/story-app';
import type { IStoryboardLogger } from '@storyboard/story-engine';
import {
  extractErrorMessage,
  isDirectSceneCardFile,
  parseSceneFileName,
  type SceneFileNameParts,
} from '@storyboard/story-model';
import { hasStoryboardProject } from '@/infrastructure/vscode/workspace';
import { showStoryboardFailure } from '@/presentation/notifications/showStoryboardFailure';
import { storyboardMessages } from '@/presentation/notifications/storyboardMessages';

function resolveSceneUri(invokedUri?: vscode.Uri): vscode.Uri | undefined {
  if (invokedUri && invokedUri.scheme === 'file') {
    return invokedUri;
  }

  const doc: vscode.TextDocument | undefined = vscode.window.activeTextEditor?.document;

  if (!doc || doc.uri.scheme !== 'file') {
    return undefined;
  }

  return doc.uri;
}

interface FormatTargetScene {
  readonly workspaceFolder: vscode.WorkspaceFolder;
  readonly stem: string;
}

async function resolveFormatTargetScene(
  sceneUri: vscode.Uri,
): Promise<FormatTargetScene | undefined> {
  const workspaceFolder: vscode.WorkspaceFolder | undefined =
    vscode.workspace.getWorkspaceFolder(sceneUri);

  if (!workspaceFolder) {
    await vscode.window.showErrorMessage('씬 파일이 속한 워크스페이스 폴더를 찾을 수 없습니다.');
    return undefined;
  }

  if (!(await hasStoryboardProject(workspaceFolder))) {
    await vscode.window.showErrorMessage(storyboardMessages.missingWorkspace);
    return undefined;
  }

  if (!isDirectSceneCardFile(sceneUri, workspaceFolder)) {
    await vscode.window.showErrorMessage(
      'Storyboard 씬 파일만 처리할 수 있습니다. `scene/NN-slug.card` 형식의 파일을 사용해 주세요.',
    );
    return undefined;
  }

  const fileName: string = sceneUri.path.split('/').pop() ?? '';
  const nameParts: SceneFileNameParts | undefined = parseSceneFileName(fileName);

  if (!nameParts) {
    await vscode.window.showErrorMessage('씬 파일명은 `NN-slug.card` 형식이어야 합니다.');
    return undefined;
  }

  return { workspaceFolder, stem: nameParts.stem };
}

export interface ApplyDraftFormatCommandDependencies {
  readonly drafts: Pick<DraftManager, 'applyFormat'>;
  readonly logger: IStoryboardLogger;
}

export class ApplyDraftFormatCommand implements IExtensionCommand {
  public readonly id: string = storyboardCommandIds.draftApplyFormat;

  public constructor(private readonly dependencies: ApplyDraftFormatCommandDependencies) {}

  public async run(invokedUri?: vscode.Uri): Promise<void> {
    const sceneUri: vscode.Uri | undefined = resolveSceneUri(invokedUri);

    if (!sceneUri) {
      await vscode.window.showErrorMessage(storyboardMessages.missingSceneUri);
      return;
    }

    await this.applyFormatToScene(sceneUri);
  }

  private async applyFormatToScene(sceneUri: vscode.Uri): Promise<void> {
    const scene: FormatTargetScene | undefined = await resolveFormatTargetScene(sceneUri);

    if (!scene) {
      return;
    }

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Storyboard 장르 포맷 적용',
          cancellable: true,
        },
        (progress, token) => this.applyFormatWithProgress(scene, progress, token),
      );
    } catch (error) {
      this.dependencies.logger.error('Apply draft format failed', error);
      this.dependencies.logger.show();
      const message: string = extractErrorMessage(error);
      await showStoryboardFailure(`장르 포맷 적용에 실패했습니다: ${message}`);
    }
  }

  private async applyFormatWithProgress(
    scene: FormatTargetScene,
    progress: vscode.Progress<{ readonly message?: string }>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    progress.report({ message: '장르 포맷 적용 중…' });

    const formatting: ApplyDraftFormatResult = await this.dependencies.drafts.applyFormat({
      workspaceRoot: scene.workspaceFolder.uri,
      sceneStem: scene.stem,
      onSaving: () => progress.report({ message: '저장 중…' }),
      shouldCancel: () => token.isCancellationRequested,
    });

    if (!formatting.ok) {
      await this.reportApplyFormatFailure(formatting);
      return;
    }

    const doc: vscode.TextDocument = await vscode.workspace.openTextDocument(formatting.draftUri);
    await vscode.window.showTextDocument(doc);
    progress.report({ message: '완료' });
    void vscode.window.showInformationMessage('장르 포맷을 적용해 초안을 저장했습니다.');
  }

  private async reportApplyFormatFailure(
    failure: Extract<ApplyDraftFormatResult, { ok: false }>,
  ): Promise<void> {
    const { logger } = this.dependencies;
    switch (failure.kind) {
      case 'cancelled':
        return;
      case 'project_unreadable':
        await vscode.window.showErrorMessage(
          'project.json을 읽을 수 없습니다. Output 패널을 확인해 주세요.',
        );
        logger.show();
        return;
      case 'draft_missing':
        await vscode.window.showErrorMessage(
          '해당 씬의 초안 파일을 찾을 수 없습니다. 먼저 초안을 생성해 주세요.',
        );
        return;
      case 'draft_invalid':
        await vscode.window.showErrorMessage(
          '초안 파일 형식이 올바르지 않습니다. Output 패널을 확인해 주세요.',
        );
        logger.show();
        return;
      case 'failed':
        logger.show();
        await showStoryboardFailure(`장르 포맷 적용에 실패했습니다: ${failure.message}`);
        return;
    }
  }
}
