import { ProjectRepository } from '@storyboard/story-engine';
import { vscodeFileSystem } from '@/infrastructure/vscode/vscodeFileSystem';
import * as vscode from 'vscode';

import {
  draftPath,
  getStoryboardProjectPaths,
  sceneFilePath,
  parseSceneFileName,
  serializeSceneCard,
  resolveScenePrefixDigitCount,
  type SceneFileNameParts,
  type StoryUri,
  type StoryboardProjectPaths,
  type StoryboardProject,
} from '@storyboard/story-model';
import {
  getTargetWorkspaceFolder,
  hasStoryboardProject,
  uriExists,
} from '@/infrastructure/vscode/workspace';
import {
  computeNextSceneOrderFromSceneFileNames,
  formatSceneOrderPrefix,
  validateSceneSlugInput,
} from './newSceneHelpers';
import type { ConfigBridge } from '@storyboard/story-ai';

export const createSceneCommand: string = 'storyboard.scene.create';
export const openSceneDraftCommand: string = 'storyboard.scene.openDraft';

export interface CreateSceneCommandDependencies {
  readonly configBridge: ConfigBridge;
}

export async function openDraftForScene(invokedUri?: vscode.Uri): Promise<void> {
  const sceneUri: vscode.Uri | undefined = resolveSceneUri(invokedUri);

  if (!sceneUri || sceneUri.scheme !== 'file') {
    await vscode.window.showErrorMessage(
      '씬 파일을 선택하거나 `scene` 폴더의 `.card` 파일을 연 뒤 다시 시도해 주세요.',
    );
    return;
  }

  const workspaceFolder: vscode.WorkspaceFolder | undefined =
    vscode.workspace.getWorkspaceFolder(sceneUri);

  if (!workspaceFolder || !(await hasStoryboardProject(workspaceFolder))) {
    await vscode.window.showWarningMessage('Storyboard 프로젝트가 아닙니다.');
    return;
  }

  const fileName: string = sceneUri.path.split('/').pop() ?? '';
  const parts: SceneFileNameParts | undefined = parseSceneFileName(fileName);

  if (!parts) {
    await vscode.window.showErrorMessage('씬 파일명은 `NN-slug.card` 형식이어야 합니다.');
    return;
  }

  const draftUri: StoryUri = draftPath(workspaceFolder.uri, parts.stem);

  if (!(await uriExists(draftUri))) {
    await vscode.window.showInformationMessage(
      '아직 이 씬에 대한 드래프트 파일이 없습니다. Generate Draft를 실행해 주세요.',
    );
    return;
  }

  const document: vscode.TextDocument = await vscode.workspace.openTextDocument(draftUri);
  await vscode.window.showTextDocument(document);
}

function resolveSceneUri(invokedUri?: vscode.Uri): vscode.Uri | undefined {
  if (invokedUri) {
    return invokedUri;
  }

  const activeUri: vscode.Uri | undefined = vscode.window.activeTextEditor?.document.uri;
  return activeUri ?? undefined;
}

export async function createNewScene(configBridge: ConfigBridge): Promise<void> {
  const workspaceFolder: vscode.WorkspaceFolder | undefined = await getTargetWorkspaceFolder();

  if (!workspaceFolder) {
    return;
  }

  const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceFolder.uri);

  if (!(await uriExists(paths.projectJson))) {
    await vscode.window.showWarningMessage(
      'Storyboard 프로젝트가 아닙니다. 먼저 Initialize Project를 실행해 주세요.',
    );
    return;
  }

  const project: StoryboardProject = await new ProjectRepository(vscodeFileSystem).read(
    paths.projectJson,
  );
  const digitCount: number = resolveScenePrefixDigitCount(
    project.editor.scenePrefixDigits,
    configBridge.inspectScenePrefixDigits(),
  );

  const directoryEntries: [string, vscode.FileType][] = await vscode.workspace.fs.readDirectory(
    paths.sceneDirectory,
  );
  const sceneFileNames: string[] = directoryEntries
    .filter(([, fileType]) => fileType === vscode.FileType.File)
    .map(([name]) => name);

  const nextOrder: number = computeNextSceneOrderFromSceneFileNames(sceneFileNames);
  const prefix: string = formatSceneOrderPrefix(nextOrder, digitCount);

  const slug: string | undefined = await vscode.window.showInputBox({
    title: '새 씬 슬러그',
    prompt: `파일명: ${prefix}-<slug>.card`,
    ignoreFocusOut: true,
    validateInput: validateSceneSlugInput,
  });

  if (!slug) {
    return;
  }

  const normalizedSlug: string = slug.trim();
  const sceneUri: StoryUri = sceneFilePath(workspaceFolder.uri, prefix, normalizedSlug);

  if (await uriExists(sceneUri)) {
    await vscode.window.showWarningMessage('이미 같은 이름의 씬 파일이 있습니다.');
    return;
  }

  const emptySceneCard: string = serializeSceneCard({
    type: 'scene',
    id: `${prefix}-${normalizedSlug}`,
  });
  await vscode.workspace.fs.writeFile(sceneUri, new TextEncoder().encode(emptySceneCard));

  const document: vscode.TextDocument = await vscode.workspace.openTextDocument(sceneUri);
  await vscode.window.showTextDocument(document);
}
