import * as vscode from 'vscode';

import { draftPath, getStoryboardProjectPaths, sceneFilePath } from '@storyboard/story-engine';
import {
  getTargetWorkspaceFolder,
  hasStoryboardProject,
  uriExists,
} from '../../infrastructure/vscode/workspace';
import { readProjectJson } from '../../infrastructure/persistence/projectJson';
import { parseSceneFileName, serializeSceneCard } from '@storyboard/story-format';
import {
  computeNextSceneOrderFromSceneFileNames,
  formatSceneOrderPrefix,
  validateSceneSlugInput,
} from './newSceneHelpers';
import { resolveScenePrefixDigitCount } from '@storyboard/story-format';

const createSceneCommand = 'storyboard.scene.create';
const openSceneDraftCommand = 'storyboard.scene.openDraft';

export function registerNewSceneCommands(): vscode.Disposable {
  return vscode.Disposable.from(
    vscode.commands.registerCommand(createSceneCommand, () => createNewScene()),
    vscode.commands.registerCommand(openSceneDraftCommand, (uri?: vscode.Uri) =>
      openDraftForScene(uri),
    ),
  );
}

async function openDraftForScene(invokedUri?: vscode.Uri): Promise<void> {
  const sceneUri = resolveSceneUri(invokedUri);

  if (!sceneUri || sceneUri.scheme !== 'file') {
    await vscode.window.showErrorMessage(
      '씬 파일을 선택하거나 `scene` 폴더의 `.card` 파일을 연 뒤 다시 시도해 주세요.',
    );
    return;
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(sceneUri);

  if (!workspaceFolder || !(await hasStoryboardProject(workspaceFolder))) {
    await vscode.window.showWarningMessage('Storyboard 프로젝트가 아닙니다.');
    return;
  }

  const fileName = sceneUri.path.split('/').pop() ?? '';
  const parts = parseSceneFileName(fileName);

  if (!parts) {
    await vscode.window.showErrorMessage('씬 파일명은 `NN-slug.card` 형식이어야 합니다.');
    return;
  }

  const draftUri = draftPath(workspaceFolder.uri, parts.stem);

  if (!(await uriExists(draftUri))) {
    await vscode.window.showInformationMessage(
      '아직 이 씬에 대한 드래프트 파일이 없습니다. Generate Draft를 실행해 주세요.',
    );
    return;
  }

  const document = await vscode.workspace.openTextDocument(draftUri);
  await vscode.window.showTextDocument(document);
}

function resolveSceneUri(invokedUri?: vscode.Uri): vscode.Uri | undefined {
  if (invokedUri) {
    return invokedUri;
  }

  const activeUri = vscode.window.activeTextEditor?.document.uri;
  return activeUri ?? undefined;
}

async function createNewScene(): Promise<void> {
  const workspaceFolder = await getTargetWorkspaceFolder();

  if (!workspaceFolder) {
    return;
  }

  const paths = getStoryboardProjectPaths(workspaceFolder.uri);

  if (!(await uriExists(paths.projectJson))) {
    await vscode.window.showWarningMessage(
      'Storyboard 프로젝트가 아닙니다. 먼저 Initialize Project를 실행해 주세요.',
    );
    return;
  }

  const project = await readProjectJson(paths.projectJson);
  const inspected = vscode.workspace
    .getConfiguration('storyboard')
    .inspect<number>('scene.prefixDigits');
  const digitCount = resolveScenePrefixDigitCount(project.editor.scenePrefixDigits, inspected);

  const directoryEntries = await vscode.workspace.fs.readDirectory(paths.sceneDirectory);
  const sceneFileNames = directoryEntries
    .filter(([, fileType]) => fileType === vscode.FileType.File)
    .map(([name]) => name);

  const nextOrder = computeNextSceneOrderFromSceneFileNames(sceneFileNames);
  const prefix = formatSceneOrderPrefix(nextOrder, digitCount);

  const slug = await vscode.window.showInputBox({
    title: '새 씬 슬러그',
    prompt: `파일명: ${prefix}-<slug>.card`,
    ignoreFocusOut: true,
    validateInput: validateSceneSlugInput,
  });

  if (!slug) {
    return;
  }

  const normalizedSlug = slug.trim();
  const sceneUri = sceneFilePath(workspaceFolder.uri, prefix, normalizedSlug);

  if (await uriExists(sceneUri)) {
    await vscode.window.showWarningMessage('이미 같은 이름의 씬 파일이 있습니다.');
    return;
  }

  const emptySceneCard = serializeSceneCard({
    type: 'scene',
    id: `${prefix}-${normalizedSlug}`,
  });
  await vscode.workspace.fs.writeFile(sceneUri, new TextEncoder().encode(emptySceneCard));

  const document = await vscode.workspace.openTextDocument(sceneUri);
  await vscode.window.showTextDocument(document);
}
