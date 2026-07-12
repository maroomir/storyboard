import * as vscode from 'vscode';

import type { DecodeSeedUseCase } from '../application/project/decode-seed-use-case';
import { type StoryboardLogger } from '../core/logger';
import { refreshStoryboardWorkspaceContext } from '../core/storyboardWorkspaceContext';
import { getStoryboardProjectPaths, type StoryboardProjectPaths } from '../core/pathConventions';
import { hasStoryboardProject, uriExists } from '../core/workspace';
import {
  buildSeedWritePlan,
  collectTrackedCardAndSceneRelativePathsFromFileNames,
  computeSeedDeletionCandidates,
  listSeedPlanContentConflictRelativePaths,
  SeedWriteAbortedError,
  type SeedFileWriteEntry,
} from '../files/seedImport';
import {
  readDirectoryFileNamesOnly,
  readParsedSeedEnvelopeFromWorkspaceRoot,
} from '../files/seedEnvelopeFromWorkspace';
import { listSeedExportPreflightIssues } from '../files/seedExportPreflight';
import {
  encodeWorkspaceToSeed,
  isSeedError,
  type DecodedSeedContent,
  type WorkspaceContent,
} from '../services/seedcoat/projectAdapter';
import {
  mapSeedErrorToMessage,
  SEED_UNKNOWN_ERROR_MESSAGE,
} from '../constants/projectStorageMessages';
import {
  applySeedIdMapping,
  SeedIdMappingConflictError,
  SeedIdMappingValidationError,
} from '../files/seedRemap';
import { createStoryboardDirectories, ensureWorkspaceGitignore } from './init';
import { formatSeedIdRemapErrorMessage, promptSeedIdRemapping } from './seedIdRemapPrompt';
import {
  deleteRelativePaths,
  readExistingContentByRelativePathForPlan,
  readSeedFile,
  uriForRelativeProjectPath,
  writeReadmeIfMissing,
  writeSeedPlanEntries,
} from './seedWriteIo';

const createFromSeedCommand = 'storyboard.seed.createFromFile';
const syncFromSeedCommand = 'storyboard.seed.syncFromFile';
const exportToSeedCommand = 'storyboard.seed.exportToFile';

const SEED_DELETE_DETAIL_LOG_THRESHOLD = 8;

async function reportSeedExportPreflightIssuesOrAbort(content: WorkspaceContent): Promise<boolean> {
  const issues = listSeedExportPreflightIssues(content);

  if (issues.length === 0) {
    return true;
  }

  await vscode.window.showErrorMessage(
    '.seed보내기를 할 수 없습니다. 씬 stem·editor.scenePrefixDigits를 Seed 내보내기 규칙(두 자리 prefix, 예: 01-opening)에 맞게 수정하세요.',
    { modal: true, detail: issues.join('\n') },
  );
  return false;
}

export interface RegisterImportSeedCommandsDependencies {
  readonly decodeSeedUseCase: DecodeSeedUseCase;
  readonly logger: StoryboardLogger;
}

export function registerImportSeedCommands(
  dependencies: RegisterImportSeedCommandsDependencies,
): vscode.Disposable {
  return vscode.Disposable.from(
    vscode.commands.registerCommand(createFromSeedCommand, () =>
      createProjectFromSeedFile(dependencies),
    ),
    vscode.commands.registerCommand(syncFromSeedCommand, (resource?: vscode.Uri) =>
      syncProjectFromSeedFile(dependencies, resource),
    ),
    vscode.commands.registerCommand(exportToSeedCommand, () =>
      exportProjectToSeedFile(dependencies),
    ),
  );
}

async function collectSeedSyncRelativePaths(workspaceRoot: vscode.Uri): Promise<string[]> {
  const paths = getStoryboardProjectPaths(workspaceRoot);
  const characterFileNames = await readDirectoryFileNamesOnly(paths.characterDirectory);
  const backgroundFileNames = await readDirectoryFileNamesOnly(paths.backgroundDirectory);
  const sceneFileNames = await readDirectoryFileNamesOnly(paths.sceneDirectory);

  return collectTrackedCardAndSceneRelativePathsFromFileNames({
    characterFileNames,
    backgroundFileNames,
    sceneFileNames,
  });
}

function formatSeedErrorMessage(error: unknown): string {
  if (isSeedError(error)) {
    return mapSeedErrorToMessage(error);
  }

  if (error instanceof Error) {
    return error.message;
  }

  return SEED_UNKNOWN_ERROR_MESSAGE;
}

async function loadDecodedSeedOrReport(
  seedUri: vscode.Uri,
  dependencies: RegisterImportSeedCommandsDependencies,
): Promise<DecodedSeedContent | undefined> {
  let bytes: Uint8Array;

  try {
    bytes = await readSeedFile(seedUri);
  } catch (error) {
    dependencies.logger.error('Seed 파일을 읽지 못했습니다.', error);
    dependencies.logger.show();
    await vscode.window.showErrorMessage(
      'Seed 파일을 읽는 데 실패했습니다. Output 패널을 확인해 주세요.',
    );
    return undefined;
  }

  const result = await dependencies.decodeSeedUseCase.execute(bytes);
  if (!result.ok) {
    await vscode.window.showErrorMessage(result.message);
    return undefined;
  }

  return result.seed;
}

async function reportSeedWriteFailure(
  error: unknown,
  logger: StoryboardLogger,
  kind: 'create' | 'sync',
): Promise<void> {
  if (error instanceof SeedWriteAbortedError) {
    logger.show();
    const abortMessage =
      kind === 'create'
        ? `Seed 반영이 중간에 실패했습니다. 이미 변경된 파일이 ${error.writtenRelativePaths.length}개 있을 수 있습니다. 필요하면 되돌린 뒤 다시 시도하세요. 상세 경로는 Output의 Storyboard 채널을 확인하세요.`
        : `Seed 동기화 중 쓰기가 중단되었습니다. 이미 변경된 파일이 ${error.writtenRelativePaths.length}개 있을 수 있습니다. 필요하면 되돌린 뒤 다시 시도하세요. 상세 경로는 Output의 Storyboard 채널을 확인하세요.`;
    await vscode.window.showErrorMessage(abortMessage);
    return;
  }

  if (kind === 'create') {
    logger.error('Seed 기반 프로젝트 생성에 실패했습니다.', error);
    logger.show();
    await vscode.window.showErrorMessage(
      'Seed 기반 프로젝트 생성에 실패했습니다. Output 패널을 확인해 주세요.',
    );
    return;
  }

  logger.error('Seed 동기화에 실패했습니다.', error);
  logger.show();
  await vscode.window.showErrorMessage('Seed 동기화에 실패했습니다. Output 패널을 확인해 주세요.');
}

async function confirmExportWithoutEncryption(): Promise<boolean> {
  const proceed = await vscode.window.showWarningMessage(
    'Seed 파일로 내보냅니다.',
    {
      modal: true,
      detail:
        '⚠ `.seed` 파일은 암호화되지 않습니다. 민감한 내용이 있다면 파일 공유에 주의하세요.\n\n다음 데이터는 .seed 파일에 포함되지 않습니다:\n• 캐릭터 아크(arc), 최근 대사(recentDialogues), 프로필 이미지 경로(profile), 속성(attributes)\n• 임시 작업 데이터(draft/)',
    },
    '계속',
    '취소',
  );

  return proceed === '계속';
}

async function pickSeedFileUri(): Promise<vscode.Uri | undefined> {
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    canSelectFolders: false,
    canSelectFiles: true,
    filters: { 'Storyboard Seed': ['seed'], '모든 파일': ['*'] },
    openLabel: 'Seed 선택',
  });

  return picked?.[0];
}

async function pickTargetDirectoryUri(): Promise<vscode.Uri | undefined> {
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    canSelectFolders: true,
    canSelectFiles: false,
    openLabel: '프로젝트 폴더 선택',
  });

  return picked?.[0];
}

async function pickStoryboardWorkspaceFolder(): Promise<vscode.WorkspaceFolder | undefined> {
  const candidates: vscode.WorkspaceFolder[] = [];

  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    if (await hasStoryboardProject(folder)) {
      candidates.push(folder);
    }
  }

  if (candidates.length === 0) {
    await vscode.window.showErrorMessage(
      '동기화할 Storyboard 프로젝트가 없습니다. `.storyboard/project.json`이 있는 폴더를 워크스페이스로 열어 주세요.',
    );
    return undefined;
  }

  if (candidates.length === 1) {
    return candidates[0];
  }

  const picked = await vscode.window.showQuickPick(
    candidates.map((folder) => ({ label: folder.name, folder })),
    { placeHolder: 'Seed를 적용할 Storyboard 프로젝트 폴더를 선택하세요.' },
  );

  return picked?.folder;
}

async function confirmOrAbortStoryboardMetadataWithoutProjectJson(
  paths: StoryboardProjectPaths,
): Promise<boolean> {
  const hasMetadata = await uriExists(paths.metadataDirectory);
  const hasProject = await uriExists(paths.projectJson);

  if (!hasMetadata || hasProject) {
    return true;
  }

  const choice = await vscode.window.showWarningMessage(
    '`.storyboard` 폴더는 있지만 `project.json`이 없습니다. Seed를 적용하면 `project.json`과 Seed에 포함된 파일이 생성됩니다. 계속하시겠습니까?',
    { modal: true },
    '계속',
    '취소',
  );

  return choice === '계속';
}

async function confirmOverwriteDifferentSeedContent(
  conflicts: readonly string[],
): Promise<boolean> {
  if (conflicts.length === 0) {
    return true;
  }

  const choice = await vscode.window.showWarningMessage(
    `Seed와 내용이 다른 기존 파일이 ${conflicts.length}개 있습니다. 덮어쓰시겠습니까?`,
    { modal: true, detail: conflicts.slice(0, 12).join('\n') },
    '덮어쓰기',
    '취소',
  );

  return choice === '덮어쓰기';
}

async function confirmOverwriteExistingSeedTargets(
  root: vscode.Uri,
  entries: readonly SeedFileWriteEntry[],
): Promise<boolean> {
  const conflicts: string[] = [];

  for (const entry of entries) {
    const target = uriForRelativeProjectPath(root, entry.relativePath);

    if (await uriExists(target)) {
      conflicts.push(entry.relativePath);
    }
  }

  if (conflicts.length === 0) {
    return true;
  }

  const choice = await vscode.window.showWarningMessage(
    `Seed가 쓰려는 경로 중 ${conflicts.length}개에 이미 파일이 있습니다. 덮어쓰시겠습니까?`,
    { modal: true, detail: conflicts.slice(0, 12).join('\n') },
    '덮어쓰기',
    '취소',
  );

  return choice === '덮어쓰기';
}

async function confirmSeedDeletionCandidates(
  deletions: readonly string[],
  logger: StoryboardLogger,
): Promise<boolean> {
  if (deletions.length === 0) {
    return true;
  }

  if (deletions.length > SEED_DELETE_DETAIL_LOG_THRESHOLD) {
    logger.info(`Seed 동기화: 삭제 예정 파일 ${deletions.length}개 (전체 목록)`);

    for (const path of deletions) {
      logger.info(`  - ${path}`);
    }
  }

  const preview =
    deletions.length <= SEED_DELETE_DETAIL_LOG_THRESHOLD
      ? deletions.join('\n')
      : `${deletions.slice(0, SEED_DELETE_DETAIL_LOG_THRESHOLD).join('\n')}\n... 외 ${deletions.length - SEED_DELETE_DETAIL_LOG_THRESHOLD}개 (나머지는 Output의 Storyboard 채널에 기록됨)`;

  const choice = await vscode.window.showWarningMessage(
    `Seed에 없는 기존 카드/씬 파일 ${deletions.length}개를 삭제합니다. 계속하시겠습니까?`,
    { modal: true, detail: preview },
    '삭제',
    '취소',
  );

  return choice === '삭제';
}

function isTargetRootInsideWorkspace(targetRoot: vscode.Uri): boolean {
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const folderPosix = folder.uri.fsPath.replace(/\\/g, '/').replace(/\/$/, '');
    const targetPosix = targetRoot.fsPath.replace(/\\/g, '/').replace(/\/$/, '');

    if (targetPosix === folderPosix || targetPosix.startsWith(`${folderPosix}/`)) {
      return true;
    }
  }

  return false;
}

async function applyOptionalSeedIdRemapping(
  seed: DecodedSeedContent,
): Promise<DecodedSeedContent | undefined> {
  const mapping = await promptSeedIdRemapping(seed);

  if (mapping === undefined) {
    return undefined;
  }

  if (mapping.size === 0) {
    return seed;
  }

  try {
    return applySeedIdMapping(seed, mapping);
  } catch (error) {
    if (
      error instanceof SeedIdMappingConflictError ||
      error instanceof SeedIdMappingValidationError
    ) {
      await vscode.window.showErrorMessage(formatSeedIdRemapErrorMessage(error));
      return undefined;
    }

    throw error;
  }
}

async function offerOpenCreatedFolder(targetRoot: vscode.Uri): Promise<void> {
  if (isTargetRootInsideWorkspace(targetRoot)) {
    return;
  }

  const choice = await vscode.window.showInformationMessage(
    'Seed로 프로젝트를 생성했습니다. 다른 폴더에 만들었으면 해당 폴더를 VS Code에서 열어야 합니다.',
    '폴더 열기',
  );

  if (choice === '폴더 열기') {
    await vscode.commands.executeCommand('vscode.openFolder', targetRoot, false);
  }
}

async function createProjectFromSeedFile(
  dependencies: RegisterImportSeedCommandsDependencies,
): Promise<void> {
  const seedUri = await pickSeedFileUri();

  if (!seedUri) {
    return;
  }

  const targetRoot = await pickTargetDirectoryUri();

  if (!targetRoot) {
    return;
  }

  const paths = getStoryboardProjectPaths(targetRoot);

  let seed = await loadDecodedSeedOrReport(seedUri, dependencies);

  if (seed === undefined) {
    return;
  }

  try {
    if (await uriExists(paths.projectJson)) {
      await vscode.window.showInformationMessage(
        '선택한 폴더에 이미 Storyboard 프로젝트(`project.json`)가 있습니다. 중단합니다.',
      );
      return;
    }

    if (!(await confirmOrAbortStoryboardMetadataWithoutProjectJson(paths))) {
      return;
    }

    const remappedSeed = await applyOptionalSeedIdRemapping(seed);

    if (remappedSeed === undefined) {
      return;
    }

    seed = remappedSeed;

    const plan = buildSeedWritePlan(seed);

    if (!(await confirmOverwriteExistingSeedTargets(targetRoot, plan))) {
      return;
    }

    await createStoryboardDirectories(paths);
    await writeSeedPlanEntries(targetRoot, plan, dependencies.logger);
    await ensureWorkspaceGitignore(paths.gitignore);
    await writeReadmeIfMissing(paths, seed.project.name);
    dependencies.logger.info(`Seed로 프로젝트를 생성했습니다: ${targetRoot.fsPath}`);
    await refreshStoryboardWorkspaceContext();
    await vscode.window.showInformationMessage(
      `Seed로 Storyboard 프로젝트를 생성했습니다: ${seed.project.name}`,
    );
    await offerOpenCreatedFolder(targetRoot);
  } catch (error) {
    await reportSeedWriteFailure(error, dependencies.logger, 'create');
  }
}

async function syncProjectFromSeedFile(
  dependencies: RegisterImportSeedCommandsDependencies,
  seedFileUri?: vscode.Uri,
): Promise<void> {
  const workspaceFolder = await pickStoryboardWorkspaceFolder();

  if (!workspaceFolder) {
    return;
  }

  const seedUri = seedFileUri ?? (await pickSeedFileUri());

  if (!seedUri) {
    return;
  }

  const paths = getStoryboardProjectPaths(workspaceFolder.uri);

  let seed = await loadDecodedSeedOrReport(seedUri, dependencies);

  if (seed === undefined) {
    return;
  }

  try {
    const remappedSeed = await applyOptionalSeedIdRemapping(seed);

    if (remappedSeed === undefined) {
      return;
    }

    seed = remappedSeed;

    const existingRelativePaths = await collectSeedSyncRelativePaths(workspaceFolder.uri);
    const deletions = computeSeedDeletionCandidates(existingRelativePaths, seed);
    const plan = buildSeedWritePlan(seed);
    const existingByPath = await readExistingContentByRelativePathForPlan(
      workspaceFolder.uri,
      plan,
    );
    const contentConflicts = listSeedPlanContentConflictRelativePaths(plan, existingByPath);

    if (!(await confirmOverwriteDifferentSeedContent(contentConflicts))) {
      return;
    }

    if (!(await confirmSeedDeletionCandidates(deletions, dependencies.logger))) {
      return;
    }

    await writeSeedPlanEntries(workspaceFolder.uri, plan, dependencies.logger);
    await deleteRelativePaths(workspaceFolder.uri, deletions);
    await ensureWorkspaceGitignore(paths.gitignore);
    dependencies.logger.info(`Seed로 프로젝트를 동기화했습니다: ${workspaceFolder.uri.fsPath}`);
    await refreshStoryboardWorkspaceContext();
    await vscode.window.showInformationMessage(
      `Seed 내용으로 프로젝트를 동기화했습니다: ${seed.project.name}`,
    );
  } catch (error) {
    await reportSeedWriteFailure(error, dependencies.logger, 'sync');
  }
}

async function exportProjectToSeedFile(
  dependencies: RegisterImportSeedCommandsDependencies,
): Promise<void> {
  const workspaceFolder = await pickStoryboardWorkspaceFolder();

  if (!workspaceFolder) {
    return;
  }

  try {
    const content = await readParsedSeedEnvelopeFromWorkspaceRoot(workspaceFolder.uri);

    if (!(await reportSeedExportPreflightIssuesOrAbort(content))) {
      return;
    }

    const safeName = content.project.name.replace(/[/\\?%*:|"<>]/g, '-').trim() || 'storyboard';
    const defaultUri = vscode.Uri.joinPath(workspaceFolder.uri, `${safeName}.seed`);
    const picked = await vscode.window.showSaveDialog({
      defaultUri,
      filters: { 'Storyboard Seed': ['seed'] },
      saveLabel: '보내기',
    });

    if (!picked) {
      return;
    }

    if (!(await confirmExportWithoutEncryption())) {
      return;
    }

    const seedBytes = await encodeWorkspaceToSeed(content);
    await vscode.workspace.fs.writeFile(picked, seedBytes);
    dependencies.logger.info(`Seed 파일을 보냈습니다: ${picked.fsPath}`);
    await vscode.window.showInformationMessage(`Seed 파일을 저장했습니다: ${picked.fsPath}`);
  } catch (error) {
    dependencies.logger.error('Seed 보내기에 실패했습니다.', error);
    dependencies.logger.show();
    await vscode.window.showErrorMessage(
      isSeedError(error) ? mapSeedErrorToMessage(error) : formatSeedErrorMessage(error),
    );
  }
}
