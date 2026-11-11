import type { IExtensionCommand } from '@/presentation/commands/extensionCommand';
import * as vscode from 'vscode';

import { validateCardRenameId } from '@/infrastructure/vscode/bundleFolderRename';
import type { CardManager } from '@storyboard/story-app';
import type { RenameCardResult } from '@storyboard/story-engine';
import {
  getStoryboardProjectPaths,
  parseCardIdFromPath,
  type StoryboardProjectPaths,
  type BibleSubjectKind,
} from '@storyboard/story-model';
import { hasStoryboardProject } from '@/infrastructure/vscode/workspace';
import { resolveActiveFileUri } from '@/presentation/commands/activeFileUri';

export interface RenameCardCommandDependencies {
  readonly cards: Pick<CardManager, 'rename'>;
}

export abstract class RenameCardCommandBase implements IExtensionCommand {
  public abstract readonly id: string;

  public constructor(private readonly dependencies: RenameCardCommandDependencies) {}

  public abstract run(...args: never[]): unknown;

  protected async rename(kind: BibleSubjectKind, invokedUri?: vscode.Uri): Promise<void> {
    const cardUri: vscode.Uri | undefined = this.resolveCardUri(kind, invokedUri);

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
      prompt:
        '새 slug 를 입력하세요. 번들 폴더 이름과 card.yaml 의 slug 한 줄이 바뀝니다. 참조는 uuid 라 다른 파일은 바뀌지 않습니다.',
      value: oldId,
      ignoreFocusOut: true,
      validateInput: validateCardRenameId,
    });

    if (!newId || newId === oldId) {
      return;
    }

    const renamed: RenameCardResult = await this.dependencies.cards.rename({
      workspaceRoot: workspaceFolder.uri,
      category: kind,
      fromId: oldId,
      toId: newId,
    });

    if (!renamed.ok) {
      await vscode.window.showWarningMessage(renamed.message);
      return;
    }
  }

  private resolveCardUri(kind: BibleSubjectKind, invokedUri?: vscode.Uri): vscode.Uri | undefined {
    const candidateUri: vscode.Uri | undefined = invokedUri ?? resolveActiveFileUri();

    if (!candidateUri || candidateUri.scheme !== 'file') {
      void vscode.window.showErrorMessage(
        '이름을 바꿀 카드(`.card` 폴더)를 고르거나 연 뒤 다시 시도해 주세요.',
      );
      return undefined;
    }

    if (parseCardIdFromPath(candidateUri) === undefined) {
      void vscode.window.showErrorMessage('Storyboard 카드만 이름을 바꿀 수 있습니다.');
      return undefined;
    }

    const workspaceFolder: vscode.WorkspaceFolder | undefined =
      vscode.workspace.getWorkspaceFolder(candidateUri);

    if (!workspaceFolder) {
      void vscode.window.showErrorMessage('워크스페이스에 속한 카드를 골라 주세요.');
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
}
