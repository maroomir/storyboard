import * as vscode from 'vscode';

import { validateCardRenameId } from '../core/cardRenameEdit';
import {
  backgroundCardPath,
  characterCardPath,
  getStoryboardProjectPaths,
  isIgnoredSampleCardFileName,
  parseCardIdFromPath,
} from '../core/pathConventions';
import { hasStoryboardProject, uriExists } from '../core/workspace';

const renameCharacterCommand = 'storyboard.character.rename';
const renameBackgroundCommand = 'storyboard.background.rename';

export function registerRenameCardCommands(): vscode.Disposable {
  return vscode.Disposable.from(
    vscode.commands.registerCommand(renameCharacterCommand, (uri?: vscode.Uri) =>
      renameCard('character', uri),
    ),
    vscode.commands.registerCommand(renameBackgroundCommand, (uri?: vscode.Uri) =>
      renameCard('background', uri),
    ),
  );
}

async function renameCard(
  kind: 'character' | 'background',
  invokedUri?: vscode.Uri,
): Promise<void> {
  const cardUri = resolveCardUri(kind, invokedUri);

  if (!cardUri) {
    return;
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(cardUri);

  if (!workspaceFolder || !(await hasStoryboardProject(workspaceFolder))) {
    await vscode.window.showWarningMessage('Storyboard 프로젝트가 아닙니다.');
    return;
  }

  const oldId = parseCardIdFromPath(cardUri);

  if (!oldId) {
    await vscode.window.showErrorMessage('카드 ID를 확인할 수 없습니다.');
    return;
  }

  const newId = await vscode.window.showInputBox({
    title: kind === 'character' ? '캐릭터 ID 변경' : '배경 ID 변경',
    prompt: '새 ID를 입력하세요. 파일명, 본문 id, 참조, 프로필 이미지가 함께 갱신됩니다.',
    value: oldId,
    ignoreFocusOut: true,
    validateInput: validateCardRenameId,
  });

  if (!newId || newId === oldId) {
    return;
  }

  const newUri =
    kind === 'character'
      ? characterCardPath(workspaceFolder.uri, newId)
      : backgroundCardPath(workspaceFolder.uri, newId);

  if (await uriExists(newUri)) {
    await vscode.window.showWarningMessage(`이미 존재하는 카드입니다: ${newId}`);
    return;
  }

  const edit = new vscode.WorkspaceEdit();
  edit.renameFile(cardUri, newUri, { overwrite: false });

  const applied = await vscode.workspace.applyEdit(edit);

  if (!applied) {
    await vscode.window.showErrorMessage('카드 rename에 실패했습니다.');
  }
}

function resolveCardUri(
  kind: 'character' | 'background',
  invokedUri?: vscode.Uri,
): vscode.Uri | undefined {
  const candidateUri = invokedUri ?? vscode.window.activeTextEditor?.document.uri;

  if (!candidateUri || candidateUri.scheme !== 'file') {
    void vscode.window.showErrorMessage(
      'rename할 `.card` 파일을 선택하거나 연 뒤 다시 시도해 주세요.',
    );
    return undefined;
  }

  const fileName = candidateUri.path.split('/').at(-1) ?? '';

  if (!fileName.endsWith('.card') || isIgnoredSampleCardFileName(fileName)) {
    void vscode.window.showErrorMessage('Storyboard 카드 파일만 rename할 수 있습니다.');
    return undefined;
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(candidateUri);

  if (!workspaceFolder) {
    void vscode.window.showErrorMessage('워크스페이스에 속한 카드 파일을 선택해 주세요.');
    return undefined;
  }

  const paths = getStoryboardProjectPaths(workspaceFolder.uri);
  const expectedDirectory =
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
