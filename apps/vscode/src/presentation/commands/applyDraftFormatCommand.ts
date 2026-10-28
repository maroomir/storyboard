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

const applyDraftFormatCommand: string = 'storyboard.draft.applyFormat';

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

export interface ApplyDraftFormatCommandDependencies {
  readonly drafts: Pick<DraftManager, 'applyFormat'>;
  readonly logger: IStoryboardLogger;
}

async function reportApplyFormatFailure(
  failure: Extract<ApplyDraftFormatResult, { ok: false }>,
  logger: IStoryboardLogger,
): Promise<void> {
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

async function runApplyDraftFormatForScene(
  sceneUri: vscode.Uri,
  dependencies: ApplyDraftFormatCommandDependencies,
): Promise<void> {
  const workspaceFolder: vscode.WorkspaceFolder | undefined =
    vscode.workspace.getWorkspaceFolder(sceneUri);

  if (!workspaceFolder) {
    await vscode.window.showErrorMessage('씬 파일이 속한 워크스페이스 폴더를 찾을 수 없습니다.');
    return;
  }

  if (!(await hasStoryboardProject(workspaceFolder))) {
    await vscode.window.showErrorMessage(storyboardMessages.missingWorkspace);
    return;
  }

  if (!isDirectSceneCardFile(sceneUri, workspaceFolder)) {
    await vscode.window.showErrorMessage(
      'Storyboard 씬 파일만 처리할 수 있습니다. `scene/NN-slug.card` 형식의 파일을 사용해 주세요.',
    );
    return;
  }

  const fileName: string = sceneUri.path.split('/').pop() ?? '';
  const nameParts: SceneFileNameParts | undefined = parseSceneFileName(fileName);

  if (!nameParts) {
    await vscode.window.showErrorMessage('씬 파일명은 `NN-slug.card` 형식이어야 합니다.');
    return;
  }

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Storyboard 장르 포맷 적용',
        cancellable: true,
      },
      async (progress, token) => {
        progress.report({ message: '장르 포맷 적용 중…' });

        const formatting: ApplyDraftFormatResult = await dependencies.drafts.applyFormat({
          workspaceRoot: workspaceFolder.uri,
          sceneStem: nameParts.stem,
          onSaving: () => progress.report({ message: '저장 중…' }),
          shouldCancel: () => token.isCancellationRequested,
        });

        if (!formatting.ok) {
          await reportApplyFormatFailure(formatting, dependencies.logger);
          return;
        }

        const doc: vscode.TextDocument = await vscode.workspace.openTextDocument(
          formatting.draftUri,
        );
        await vscode.window.showTextDocument(doc);
        progress.report({ message: '완료' });
        void vscode.window.showInformationMessage('장르 포맷을 적용해 초안을 저장했습니다.');
      },
    );
  } catch (error) {
    dependencies.logger.error('Apply draft format failed', error);
    dependencies.logger.show();
    const message: string = extractErrorMessage(error);
    await showStoryboardFailure(`장르 포맷 적용에 실패했습니다: ${message}`);
  }
}

async function runCommand(
  invokedUri: vscode.Uri | undefined,
  dependencies: ApplyDraftFormatCommandDependencies,
): Promise<void> {
  const sceneUri: vscode.Uri | undefined = resolveSceneUri(invokedUri);

  if (!sceneUri) {
    await vscode.window.showErrorMessage(storyboardMessages.missingSceneUri);
    return;
  }

  await runApplyDraftFormatForScene(sceneUri, dependencies);
}

export class ApplyDraftFormatCommand implements IExtensionCommand {
  public readonly id: string = applyDraftFormatCommand;

  public constructor(private readonly dependencies: ApplyDraftFormatCommandDependencies) {}

  public run(uri?: vscode.Uri): unknown {
    return runCommand(uri, this.dependencies);
  }
}
