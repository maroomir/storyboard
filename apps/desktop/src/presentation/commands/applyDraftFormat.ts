import * as vscode from 'vscode';

import type {
  ApplyDraftFormatResult,
  ApplyDraftFormatUseCase,
} from '../../application/drafts/applyDraftFormatUseCase';
import type { StoryboardLogger } from '../../infrastructure/vscode/logger';
import { isDirectSceneCardFile } from '../../infrastructure/vscode/pathConventions';
import { hasStoryboardProject } from '../../infrastructure/vscode/workspace';
import { parseSceneFileName } from '@storyboard/story-format';

const applyDraftFormatCommand = 'storyboard.draft.applyFormat';

function resolveSceneUri(invokedUri?: vscode.Uri): vscode.Uri | undefined {
  if (invokedUri && invokedUri.scheme === 'file') {
    return invokedUri;
  }

  const doc = vscode.window.activeTextEditor?.document;

  if (!doc || doc.uri.scheme !== 'file') {
    return undefined;
  }

  return doc.uri;
}

export interface RegisterApplyDraftFormatCommandDependencies {
  readonly applyDraftFormatUseCase: ApplyDraftFormatUseCase;
  readonly logger: StoryboardLogger;
}

async function reportApplyFormatFailure(
  result: Extract<ApplyDraftFormatResult, { ok: false }>,
  logger: StoryboardLogger,
): Promise<void> {
  switch (result.kind) {
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
      await vscode.window.showErrorMessage(`장르 포맷 적용에 실패했습니다: ${result.message}`);
      return;
  }
}

async function runApplyDraftFormatForScene(
  sceneUri: vscode.Uri,
  dependencies: RegisterApplyDraftFormatCommandDependencies,
): Promise<void> {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(sceneUri);

  if (!workspaceFolder) {
    await vscode.window.showErrorMessage('씬 파일이 속한 워크스페이스 폴더를 찾을 수 없습니다.');
    return;
  }

  if (!(await hasStoryboardProject(workspaceFolder))) {
    await vscode.window.showErrorMessage(
      'Storyboard 프로젝트(.storyboard/project.json)가 없습니다. 먼저 초기화해 주세요.',
    );
    return;
  }

  if (!isDirectSceneCardFile(sceneUri, workspaceFolder)) {
    await vscode.window.showErrorMessage(
      'Storyboard 씬 파일만 처리할 수 있습니다. `scene/NN-slug.card` 형식의 파일을 사용해 주세요.',
    );
    return;
  }

  const fileName = sceneUri.path.split('/').pop() ?? '';
  const nameParts = parseSceneFileName(fileName);

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

        const result = await dependencies.applyDraftFormatUseCase.execute({
          workspaceRoot: workspaceFolder.uri,
          sceneStem: nameParts.stem,
          onSaving: () => progress.report({ message: '저장 중…' }),
          shouldCancel: () => token.isCancellationRequested,
        });

        if (!result.ok) {
          await reportApplyFormatFailure(result, dependencies.logger);
          return;
        }

        const doc = await vscode.workspace.openTextDocument(result.draftUri);
        await vscode.window.showTextDocument(doc);
        progress.report({ message: '완료' });
        void vscode.window.showInformationMessage('장르 포맷을 적용해 초안을 저장했습니다.');
      },
    );
  } catch (error) {
    dependencies.logger.error('Apply draft format failed', error);
    dependencies.logger.show();
    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(`장르 포맷 적용에 실패했습니다: ${message}`);
  }
}

async function runCommand(
  invokedUri: vscode.Uri | undefined,
  dependencies: RegisterApplyDraftFormatCommandDependencies,
): Promise<void> {
  const sceneUri = resolveSceneUri(invokedUri);

  if (!sceneUri) {
    await vscode.window.showErrorMessage(
      '씬 파일 URI가 없습니다. `scene` 폴더의 `.card` 파일을 열거나 탐색기에서 명령을 실행해 주세요.',
    );
    return;
  }

  await runApplyDraftFormatForScene(sceneUri, dependencies);
}

export function registerApplyDraftFormatCommand(
  dependencies: RegisterApplyDraftFormatCommandDependencies,
): vscode.Disposable {
  return vscode.commands.registerCommand(applyDraftFormatCommand, (uri?: vscode.Uri) =>
    runCommand(uri, dependencies),
  );
}
