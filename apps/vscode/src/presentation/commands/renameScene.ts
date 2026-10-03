import * as vscode from 'vscode';

import type { DraftManager, RunGate } from '@storyboard/story-app';
import {
  getStoryboardProjectPaths,
  scenePath,
  parseSceneFileName,
  parseSceneStem,
} from '@storyboard/story-model';
import {
  hasStoryboardProject,
  resolveStoryboardWorkspaceRoot,
  uriExists,
} from '@/infrastructure/vscode/workspace';
import { runHoldingWorkspaceLock } from './workspaceRunLock';

const renameSceneCommand = 'storyboard.scene.rename';

export interface RegisterRenameSceneCommandDependencies {
  readonly drafts: Pick<DraftManager, 'renameScene'>;
  readonly runGate: Pick<RunGate, 'hold'>;
}

export function registerRenameSceneCommand(
  dependencies: RegisterRenameSceneCommandDependencies,
): vscode.Disposable {
  return vscode.commands.registerCommand(renameSceneCommand, (uri?: vscode.Uri) =>
    renameScene(dependencies, uri),
  );
}

async function renameScene(
  dependencies: RegisterRenameSceneCommandDependencies,
  invokedUri?: vscode.Uri,
): Promise<void> {
  const target = await resolveTargetScene(invokedUri);

  if (!target) {
    return;
  }

  const { workspaceRoot, fromStem } = target;
  const toStem = await vscode.window.showInputBox({
    title: '씬 이름 변경',
    prompt:
      '새 이름을 NN-slug 형식으로 입력하세요. 초안·요약·기억·캐시가 함께 옮겨지고 원장과 정전의 참조도 고쳐집니다.',
    value: fromStem,
    ignoreFocusOut: true,
    validateInput: (value) =>
      parseSceneStem(value.trim()) === undefined
        ? '`03-night-market` 처럼 번호-영문 소문자 형식이어야 합니다.'
        : undefined,
  });

  if (!toStem || toStem.trim() === fromStem) {
    return;
  }

  await runHoldingWorkspaceLock(dependencies.runGate, workspaceRoot, '씬 이름 변경', async () => {
    const result = await dependencies.drafts.renameScene({
      workspaceRoot,
      fromStem,
      toStem: toStem.trim(),
    });

    if (!result.ok) {
      await vscode.window.showWarningMessage(result.message);
      return;
    }

    const wasOpen = vscode.window.activeTextEditor?.document.uri.path.endsWith(`/${fromStem}.card`);

    if (wasOpen) {
      await vscode.commands.executeCommand(
        'vscode.open',
        scenePath(workspaceRoot, result.toStem) as vscode.Uri,
      );
    }

    void vscode.window.showInformationMessage(
      `${result.fromStem} → ${result.toStem}: 파일 ${result.movedFiles.length}개를 옮기고 ${result.rewrittenFiles.length}개를 고쳤습니다.${
        result.hasOrderChanged
          ? ' 번호가 바뀌어 아웃라인의 자리와 장 배정도 새 번호를 따릅니다.'
          : ''
      }`,
    );
  });
}

interface TargetScene {
  readonly workspaceRoot: vscode.Uri;
  readonly fromStem: string;
}

// The explorer passes the card it was opened on; from the palette the active editor's scene is
// used, and failing that the author picks one.
async function resolveTargetScene(invokedUri?: vscode.Uri): Promise<TargetScene | undefined> {
  const workspaceRoot = invokedUri
    ? vscode.workspace.getWorkspaceFolder(invokedUri)?.uri
    : await resolveStoryboardWorkspaceRoot();
  const workspaceFolder = workspaceRoot && vscode.workspace.getWorkspaceFolder(workspaceRoot);

  if (!workspaceRoot || !workspaceFolder || !(await hasStoryboardProject(workspaceFolder))) {
    await vscode.window.showWarningMessage('Storyboard 프로젝트가 아닙니다.');
    return undefined;
  }

  const sceneDirectory = getStoryboardProjectPaths(workspaceRoot).sceneDirectory.path;
  const candidateUri = invokedUri ?? vscode.window.activeTextEditor?.document.uri;
  const candidateParts =
    candidateUri && candidateUri.path.startsWith(`${sceneDirectory}/`)
      ? parseSceneFileName(candidateUri.path.split('/').at(-1) ?? '')
      : undefined;

  if (candidateParts) {
    return { workspaceRoot, fromStem: candidateParts.stem };
  }

  if (invokedUri) {
    await vscode.window.showErrorMessage(
      '`scene` 폴더의 `NN-slug.card` 파일만 이름을 바꿀 수 있습니다.',
    );
    return undefined;
  }

  const stems = await listSceneStems(workspaceRoot);
  const picked = await vscode.window.showQuickPick(stems, {
    title: '씬 이름 변경',
    placeHolder: '이름을 바꿀 씬을 고르세요',
  });

  return picked ? { workspaceRoot, fromStem: picked } : undefined;
}

async function listSceneStems(workspaceRoot: vscode.Uri): Promise<string[]> {
  const sceneDirectory = getStoryboardProjectPaths(workspaceRoot).sceneDirectory as vscode.Uri;

  if (!(await uriExists(sceneDirectory))) {
    return [];
  }

  const entries = await vscode.workspace.fs.readDirectory(sceneDirectory);

  return entries
    .flatMap(([fileName]) => parseSceneFileName(fileName) ?? [])
    .sort((left, right) => left.order - right.order)
    .map((parts) => parts.stem);
}
