import * as vscode from 'vscode';

import {
  CardParseError,
  STORYBOARD_GLOBS,
  cardIdPattern,
  parseCard,
  rewriteCardIdReferences,
  serializeCard,
  setCardId,
  isIgnoredSampleCardFileName,
  characterProfilePath,
  getStoryboardProjectPaths,
  parseCardIdFromPath,
  type StoryboardProjectPaths,
  type StoryboardCard,
  type StoryUri,
} from '@storyboard/story-model';
import { uriExists } from './workspace';

export interface CardRenameCandidate {
  readonly kind: 'character' | 'background';
  readonly workspaceRoot: vscode.Uri;
  readonly oldId: string;
  readonly newId: string;
}

function isSameWorkspaceFolder(
  oldUri: vscode.Uri,
  newUri: vscode.Uri,
): vscode.WorkspaceFolder | undefined {
  const workspaceFolder: vscode.WorkspaceFolder | undefined =
    vscode.workspace.getWorkspaceFolder(oldUri);
  const newWorkspaceFolder: vscode.WorkspaceFolder | undefined =
    vscode.workspace.getWorkspaceFolder(newUri);

  if (
    !workspaceFolder ||
    !newWorkspaceFolder ||
    workspaceFolder.uri.toString() !== newWorkspaceFolder.uri.toString()
  ) {
    return undefined;
  }

  return workspaceFolder;
}

function isValidCardFileName(fileName: string): boolean {
  return !isIgnoredSampleCardFileName(fileName) && fileName.endsWith('.card');
}

export function parseCardRenameCandidate(
  oldUri: vscode.Uri,
  newUri: vscode.Uri,
): CardRenameCandidate | undefined {
  if (oldUri.scheme !== 'file' || newUri.scheme !== 'file') {
    return undefined;
  }

  const workspaceFolder: vscode.WorkspaceFolder | undefined = isSameWorkspaceFolder(oldUri, newUri);

  if (!workspaceFolder) {
    return undefined;
  }

  const oldFileName: string = oldUri.path.split('/').at(-1) ?? '';
  const newFileName: string = newUri.path.split('/').at(-1) ?? '';

  if (!isValidCardFileName(oldFileName) || !isValidCardFileName(newFileName)) {
    return undefined;
  }

  const oldId: string | undefined = parseCardIdFromPath(oldUri);
  const newId: string | undefined = parseCardIdFromPath(newUri);

  if (!oldId || !newId) {
    return undefined;
  }

  const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceFolder.uri);
  const oldDirectory: string = oldUri.path.slice(0, -oldFileName.length);
  const newDirectory: string = newUri.path.slice(0, -newFileName.length);

  if (oldDirectory !== newDirectory) {
    return undefined;
  }

  if (oldDirectory === `${paths.characterDirectory.path}/`) {
    return { kind: 'character', workspaceRoot: workspaceFolder.uri, oldId, newId };
  }

  if (oldDirectory === `${paths.backgroundDirectory.path}/`) {
    return { kind: 'background', workspaceRoot: workspaceFolder.uri, oldId, newId };
  }

  return undefined;
}

export function validateCardRenameId(newId: string): string | undefined {
  if (!cardIdPattern.test(newId)) {
    return 'ID는 영문 소문자, 숫자, 하이픈만 사용할 수 있고 숫자/문자로 시작해야 합니다.';
  }

  return undefined;
}

export async function buildCardRenameWorkspaceEdit(
  oldUri: vscode.Uri,
  newUri: vscode.Uri,
): Promise<vscode.WorkspaceEdit | undefined> {
  const edit: vscode.WorkspaceEdit = new vscode.WorkspaceEdit();
  const appended: boolean = await appendCardRenameWorkspaceEdit(edit, oldUri, newUri);

  return appended ? edit : undefined;
}

export async function appendCardRenameWorkspaceEdit(
  edit: vscode.WorkspaceEdit,
  oldUri: vscode.Uri,
  newUri: vscode.Uri,
): Promise<boolean> {
  const candidate: CardRenameCandidate | undefined = parseCardRenameCandidate(oldUri, newUri);

  if (!candidate) {
    return false;
  }

  const validationMessage: string | undefined = validateCardRenameId(candidate.newId);

  if (validationMessage) {
    throw new CardRenameValidationError(validationMessage);
  }

  const oldCardBytes: Uint8Array<ArrayBufferLike> = await vscode.workspace.fs.readFile(oldUri);
  const oldCardText: string = new TextDecoder().decode(oldCardBytes);
  let renamedCard: StoryboardCard;

  try {
    renamedCard = setCardId(parseCard(oldCardText), candidate.newId);
  } catch (error) {
    const message: string =
      error instanceof CardParseError
        ? error.message
        : '카드 본문을 읽을 수 없어 rename을 적용할 수 없습니다.';
    throw new CardRenameValidationError(message);
  }

  replaceFileText(edit, oldUri, serializeCard(renamedCard), oldCardText);

  if (candidate.kind === 'character') {
    await appendCharacterReferenceUpdates(edit, candidate, oldUri, newUri);
    await appendProfileImageRename(edit, candidate);
  }

  return true;
}

export class CardRenameValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'CardRenameValidationError';
  }
}

async function appendCharacterReferenceUpdates(
  edit: vscode.WorkspaceEdit,
  candidate: CardRenameCandidate,
  oldUri: vscode.Uri,
  newUri: vscode.Uri,
): Promise<void> {
  const characterUris: vscode.Uri[] = await vscode.workspace.findFiles(
    new vscode.RelativePattern(candidate.workspaceRoot, STORYBOARD_GLOBS.characterCards),
  );

  for (const cardUri of characterUris) {
    if (cardUri.toString() === oldUri.toString() || cardUri.toString() === newUri.toString()) {
      continue;
    }

    await appendReferenceUpdateIfChanged(edit, cardUri, candidate.oldId, candidate.newId);
  }

  const backgroundUris: vscode.Uri[] = await vscode.workspace.findFiles(
    new vscode.RelativePattern(candidate.workspaceRoot, STORYBOARD_GLOBS.backgroundCards),
  );

  for (const cardUri of backgroundUris) {
    await appendReferenceUpdateIfChanged(edit, cardUri, candidate.oldId, candidate.newId);
  }
}

async function appendReferenceUpdateIfChanged(
  edit: vscode.WorkspaceEdit,
  cardUri: vscode.Uri,
  oldId: string,
  newId: string,
): Promise<void> {
  const fileName: string = cardUri.path.split('/').at(-1) ?? '';

  if (isIgnoredSampleCardFileName(fileName)) {
    return;
  }

  const cardBytes: Uint8Array<ArrayBufferLike> = await vscode.workspace.fs.readFile(cardUri);
  const cardText: string = new TextDecoder().decode(cardBytes);
  let card: StoryboardCard;

  try {
    card = parseCard(cardText);
  } catch (error) {
    const message: string =
      error instanceof CardParseError
        ? error.message
        : '참조 카드를 읽을 수 없어 rename을 적용할 수 없습니다.';
    throw new CardRenameValidationError(message);
  }

  const updatedCard: StoryboardCard = rewriteCardIdReferences(card, oldId, newId);

  if (updatedCard === card) {
    return;
  }

  replaceFileText(edit, cardUri, serializeCard(updatedCard), cardText);
}

async function appendProfileImageRename(
  edit: vscode.WorkspaceEdit,
  candidate: CardRenameCandidate,
): Promise<void> {
  const oldProfileUri: StoryUri = characterProfilePath(candidate.workspaceRoot, candidate.oldId);
  const newProfileUri: StoryUri = characterProfilePath(candidate.workspaceRoot, candidate.newId);

  if (await uriExists(oldProfileUri)) {
    edit.renameFile(oldProfileUri, newProfileUri, { overwrite: false, ignoreIfExists: false });
  }
}

function replaceFileText(
  edit: vscode.WorkspaceEdit,
  uri: vscode.Uri,
  nextText: string,
  currentText: string,
): void {
  const lines: string[] = currentText.split('\n');
  const endLine: number = Math.max(lines.length - 1, 0);
  const endCharacter: number = lines.at(-1)?.length ?? 0;

  edit.replace(
    uri,
    new vscode.Range(new vscode.Position(0, 0), new vscode.Position(endLine, endCharacter)),
    nextText,
  );
}
