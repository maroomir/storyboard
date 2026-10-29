import * as vscode from 'vscode';

import { validateCardRenameId } from '@/infrastructure/vscode/cardRenameEdit';
import {
  backgroundCardPath,
  characterCardPath,
  getStoryboardProjectPaths,
  parseCardIdFromPath,
  studioSessionEntityDirectory,
  isIgnoredSampleCardFileName,
  type StoryUri,
  type StoryboardProjectPaths,
  type BibleSubjectKind,
} from '@storyboard/story-model';
import { hasStoryboardProject, uriExists } from '@/infrastructure/vscode/workspace';

export async function renameCard(kind: BibleSubjectKind, invokedUri?: vscode.Uri): Promise<void> {
  const cardUri: vscode.Uri | undefined = resolveCardUri(kind, invokedUri);

  if (!cardUri) {
    return;
  }

  const workspaceFolder: vscode.WorkspaceFolder | undefined =
    vscode.workspace.getWorkspaceFolder(cardUri);

  if (!workspaceFolder || !(await hasStoryboardProject(workspaceFolder))) {
    await vscode.window.showWarningMessage('Storyboard 프로젝트가 아닙니다.');
    return;
  }

  const oldId: string | undefined = parseCardIdFromPath(cardUri);

  if (!oldId) {
    await vscode.window.showErrorMessage('카드 ID를 확인할 수 없습니다.');
    return;
  }

  const newId: string | undefined = await vscode.window.showInputBox({
    title: kind === 'character' ? '캐릭터 ID 변경' : '배경 ID 변경',
    prompt: '새 ID를 입력하세요. 파일명, 본문 id, 참조, 프로필 이미지가 함께 갱신됩니다.',
    value: oldId,
    ignoreFocusOut: true,
    validateInput: validateCardRenameId,
  });

  if (!newId || newId === oldId) {
    return;
  }

  const newUri: StoryUri =
    kind === 'character'
      ? characterCardPath(workspaceFolder.uri, newId)
      : backgroundCardPath(workspaceFolder.uri, newId);

  if (await uriExists(newUri)) {
    await vscode.window.showWarningMessage(`이미 존재하는 카드입니다: ${newId}`);
    return;
  }

  const edit: vscode.WorkspaceEdit = new vscode.WorkspaceEdit();
  edit.renameFile(cardUri, newUri, { overwrite: false });

  const applied: boolean = await vscode.workspace.applyEdit(edit);

  if (!applied) {
    await vscode.window.showErrorMessage('카드 rename에 실패했습니다.');
    return;
  }

  await moveStudioSessions(workspaceFolder.uri, kind, oldId, newId);
}

async function moveStudioSessions(
  workspaceRoot: vscode.Uri,
  kind: BibleSubjectKind,
  oldId: string,
  newId: string,
): Promise<void> {
  const source: StoryUri | undefined = studioSessionEntityDirectory(workspaceRoot, {
    kind,
    key: oldId,
  });
  const destination: StoryUri | undefined = studioSessionEntityDirectory(workspaceRoot, {
    kind,
    key: newId,
  });

  if (!source || !destination || !(await uriExists(source))) {
    return;
  }

  try {
    await vscode.workspace.fs.rename(source, destination, { overwrite: false });
  } catch {
    await vscode.window.showWarningMessage(
      `카드는 rename되었지만 Studio 대화 기록을 옮기지 못했습니다: ${oldId}`,
    );
  }
}

function resolveCardUri(kind: BibleSubjectKind, invokedUri?: vscode.Uri): vscode.Uri | undefined {
  const candidateUri: vscode.Uri | undefined =
    invokedUri ?? vscode.window.activeTextEditor?.document.uri;

  if (!candidateUri || candidateUri.scheme !== 'file') {
    void vscode.window.showErrorMessage(
      'rename할 `.card` 파일을 선택하거나 연 뒤 다시 시도해 주세요.',
    );
    return undefined;
  }

  const fileName: string = candidateUri.path.split('/').at(-1) ?? '';

  if (!fileName.endsWith('.card') || isIgnoredSampleCardFileName(fileName)) {
    void vscode.window.showErrorMessage('Storyboard 카드 파일만 rename할 수 있습니다.');
    return undefined;
  }

  const workspaceFolder: vscode.WorkspaceFolder | undefined =
    vscode.workspace.getWorkspaceFolder(candidateUri);

  if (!workspaceFolder) {
    void vscode.window.showErrorMessage('워크스페이스에 속한 카드 파일을 선택해 주세요.');
    return undefined;
  }

  const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceFolder.uri);
  const expectedDirectory: string =
    kind === 'character' ? paths.characterDirectory.path : paths.backgroundDirectory.path;

  if (!candidateUri.path.startsWith(`${expectedDirectory}/`)) {
    void vscode.window.showErrorMessage(
      kind === 'character'
        ? '`character` 폴더의 카드만 rename할 수 있습니다.'
        : '`background` 폴더의 카드만 rename할 수 있습니다.',
    );
    return undefined;
  }

  return candidateUri;
}
