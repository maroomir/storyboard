import * as vscode from 'vscode';

import { convertLegacySceneText, isLegacySceneFileName } from '@storyboard/story-format';
import type { IStoryboardLogger } from '@storyboard/story-engine';
import { getStoryboardProjectPaths } from '@storyboard/story-engine';
import {
  getTargetWorkspaceFolder,
  hasStoryboardProject,
  uriExists,
} from '@/infrastructure/vscode/workspace';

const migrateScenesCommand = 'storyboard.scene.migrate';

export function registerMigrateScenesCommand(dependencies: {
  readonly logger: IStoryboardLogger;
}): vscode.Disposable {
  return vscode.commands.registerCommand(migrateScenesCommand, () =>
    runMigrate(dependencies.logger),
  );
}

async function runMigrate(logger: IStoryboardLogger): Promise<void> {
  const workspaceFolder = await getTargetWorkspaceFolder();

  if (!workspaceFolder) {
    return;
  }

  if (!(await hasStoryboardProject(workspaceFolder))) {
    await vscode.window.showWarningMessage('Storyboard 프로젝트가 아닙니다.');
    return;
  }

  const paths = getStoryboardProjectPaths(workspaceFolder.uri);
  const legacyFileNames = await listLegacySceneFileNames(paths.sceneDirectory);

  if (legacyFileNames.length === 0) {
    await vscode.window.showInformationMessage('변환할 구형 씬(.txt)이 없습니다.');
    return;
  }

  const confirmLabel = '변환';
  const choice = await vscode.window.showWarningMessage(
    `구형 씬 ${legacyFileNames.length}개를 scene.card로 변환하고 원본 .txt를 삭제합니다. 계속할까요?`,
    { modal: true },
    confirmLabel,
  );

  if (choice !== confirmLabel) {
    return;
  }

  const failures: string[] = [];
  let convertedCount = 0;

  for (const legacyFileName of legacyFileNames) {
    const failure = await migrateOneScene(paths.sceneDirectory, legacyFileName, logger);

    if (failure === undefined) {
      convertedCount += 1;
    } else {
      failures.push(failure);
    }
  }

  if (failures.length === 0) {
    await vscode.window.showInformationMessage(
      `${convertedCount}개 씬을 scene.card로 변환했습니다.`,
    );
    return;
  }

  await vscode.window.showWarningMessage(
    `${convertedCount}개 변환, ${failures.length}개 실패: ${failures.join(', ')} — 자세한 내용은 로그를 확인해 주세요.`,
  );
}

async function listLegacySceneFileNames(sceneDirectory: vscode.Uri): Promise<string[]> {
  let entries: [string, vscode.FileType][];

  try {
    entries = await vscode.workspace.fs.readDirectory(sceneDirectory);
  } catch {
    return [];
  }

  return entries
    .filter(([name, fileType]) => fileType === vscode.FileType.File && isLegacySceneFileName(name))
    .map(([name]) => name)
    .sort();
}

async function migrateOneScene(
  sceneDirectory: vscode.Uri,
  legacyFileName: string,
  logger: IStoryboardLogger,
): Promise<string | undefined> {
  const legacyUri = vscode.Uri.joinPath(sceneDirectory, legacyFileName);

  try {
    const rawScene = new TextDecoder().decode(await vscode.workspace.fs.readFile(legacyUri));
    const conversion = convertLegacySceneText(rawScene, legacyFileName);
    const cardUri = vscode.Uri.joinPath(sceneDirectory, conversion.fileName);

    if (await uriExists(cardUri)) {
      logger.warn(`씬 마이그레이션 건너뜀: ${conversion.fileName} 이미 존재`);
      return legacyFileName;
    }

    await vscode.workspace.fs.writeFile(cardUri, new TextEncoder().encode(conversion.text));
    await vscode.workspace.fs.delete(legacyUri);
    return undefined;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logger.warn(`씬 마이그레이션 실패: ${legacyFileName} — ${detail}`);
    return legacyFileName;
  }
}
