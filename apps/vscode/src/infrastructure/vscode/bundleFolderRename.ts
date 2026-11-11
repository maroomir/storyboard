import * as vscode from 'vscode';

import {
  cardIdPattern,
  elementKindDirectories,
  parseBundleDirectoryName,
  STORYBOARD_FILE_EXTENSIONS,
  type ElementKind,
} from '@storyboard/story-model';

export type RenamableBundleKind = Extract<ElementKind, 'character' | 'background' | 'scene'>;

export interface BundleFolderRename {
  readonly kind: RenamableBundleKind;
  readonly workspaceRoot: vscode.Uri;
  readonly oldUri: vscode.Uri;
  readonly newUri: vscode.Uri;
  readonly fromKey: string;
  readonly toKey: string;
}

interface PathParts {
  readonly parent: string;
  readonly name: string;
}

const renamableKinds: readonly RenamableBundleKind[] = ['character', 'background', 'scene'];

function findSharedWorkspaceFolder(
  oldUri: vscode.Uri,
  newUri: vscode.Uri,
): vscode.WorkspaceFolder | undefined {
  const workspaceFolder: vscode.WorkspaceFolder | undefined =
    vscode.workspace.getWorkspaceFolder(oldUri);
  const newWorkspaceFolder: vscode.WorkspaceFolder | undefined =
    vscode.workspace.getWorkspaceFolder(newUri);

  return workspaceFolder !== undefined &&
    newWorkspaceFolder?.uri.toString() === workspaceFolder.uri.toString()
    ? workspaceFolder
    : undefined;
}

function splitParentAndName(path: string): PathParts {
  const slashIndex: number = path.lastIndexOf('/');
  return { parent: path.slice(0, slashIndex), name: path.slice(slashIndex + 1) };
}

function findKindOfParent(
  workspaceFolder: vscode.WorkspaceFolder,
  parent: string,
): RenamableBundleKind | undefined {
  return renamableKinds.find(
    (kind) => parent === `${workspaceFolder.uri.path}/${elementKindDirectories[kind]}`,
  );
}

function toBundleKey(kind: RenamableBundleKind, directoryName: string): string | undefined {
  return parseBundleDirectoryName(kind, directoryName) === undefined
    ? undefined
    : directoryName.slice(0, -STORYBOARD_FILE_EXTENSIONS.card.length);
}

export function parseBundleFolderRename(
  oldUri: vscode.Uri,
  newUri: vscode.Uri,
): BundleFolderRename | undefined {
  const workspaceFolder: vscode.WorkspaceFolder | undefined =
    oldUri.scheme === 'file' && newUri.scheme === 'file'
      ? findSharedWorkspaceFolder(oldUri, newUri)
      : undefined;
  const from: PathParts = splitParentAndName(oldUri.path);
  const to: PathParts = splitParentAndName(newUri.path);
  const kind: RenamableBundleKind | undefined =
    workspaceFolder === undefined || from.parent !== to.parent
      ? undefined
      : findKindOfParent(workspaceFolder, from.parent);
  const fromKey: string | undefined = kind === undefined ? undefined : toBundleKey(kind, from.name);
  const toKey: string | undefined = kind === undefined ? undefined : toBundleKey(kind, to.name);
  const isBundleRename: boolean =
    kind !== undefined && fromKey !== undefined && toKey !== undefined && fromKey !== toKey;

  return isBundleRename && workspaceFolder !== undefined
    ? {
        kind: kind as RenamableBundleKind,
        workspaceRoot: workspaceFolder.uri,
        oldUri,
        newUri,
        fromKey: fromKey as string,
        toKey: toKey as string,
      }
    : undefined;
}

export function validateCardRenameId(newId: string): string | undefined {
  if (!cardIdPattern.test(newId)) {
    return 'ID는 영문 소문자, 숫자, 하이픈만 사용할 수 있고 숫자/문자로 시작해야 합니다.';
  }

  return undefined;
}
