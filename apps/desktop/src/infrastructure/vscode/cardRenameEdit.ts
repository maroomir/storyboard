import * as vscode from 'vscode';

import { CardParseError, parseCard, serializeCard } from '../../domain/files/card';
import { cardIdPattern } from '../../shared/card';
import { rewriteCardIdReferences, setCardId } from '../../domain/cardReferenceRewriter';
import {
  characterProfilePath,
  getStoryboardProjectPaths,
  isIgnoredSampleCardFileName,
  parseCardIdFromPath,
} from './pathConventions';
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
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(oldUri);
  const newWorkspaceFolder = vscode.workspace.getWorkspaceFolder(newUri);

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

  const workspaceFolder = isSameWorkspaceFolder(oldUri, newUri);

  if (!workspaceFolder) {
    return undefined;
  }

  const oldFileName = oldUri.path.split('/').at(-1) ?? '';
  const newFileName = newUri.path.split('/').at(-1) ?? '';

  if (!isValidCardFileName(oldFileName) || !isValidCardFileName(newFileName)) {
    return undefined;
  }

  const oldId = parseCardIdFromPath(oldUri);
  const newId = parseCardIdFromPath(newUri);

  if (!oldId || !newId) {
    return undefined;
  }

  const paths = getStoryboardProjectPaths(workspaceFolder.uri);
  const oldDirectory = oldUri.path.slice(0, -oldFileName.length);
  const newDirectory = newUri.path.slice(0, -newFileName.length);

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
  const edit = new vscode.WorkspaceEdit();
  const appended = await appendCardRenameWorkspaceEdit(edit, oldUri, newUri);

  return appended ? edit : undefined;
}

export async function appendCardRenameWorkspaceEdit(
  edit: vscode.WorkspaceEdit,
  oldUri: vscode.Uri,
  newUri: vscode.Uri,
): Promise<boolean> {
  const candidate = parseCardRenameCandidate(oldUri, newUri);

  if (!candidate) {
    return false;
  }

  const validationMessage = validateCardRenameId(candidate.newId);

  if (validationMessage) {
    throw new CardRenameValidationError(validationMessage);
  }

  const oldCardBytes = await vscode.workspace.fs.readFile(oldUri);
  const oldCardText = new TextDecoder().decode(oldCardBytes);
  let renamedCard;

  try {
    renamedCard = setCardId(parseCard(oldCardText), candidate.newId);
  } catch (error) {
    const message =
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
  const characterUris = await vscode.workspace.findFiles(
    new vscode.RelativePattern(candidate.workspaceRoot, 'character/*.card'),
  );

  for (const cardUri of characterUris) {
    if (cardUri.toString() === oldUri.toString() || cardUri.toString() === newUri.toString()) {
      continue;
    }

    await appendReferenceUpdateIfChanged(edit, cardUri, candidate.oldId, candidate.newId);
  }

  const backgroundUris = await vscode.workspace.findFiles(
    new vscode.RelativePattern(candidate.workspaceRoot, 'background/*.card'),
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
  const fileName = cardUri.path.split('/').at(-1) ?? '';

  if (isIgnoredSampleCardFileName(fileName)) {
    return;
  }

  const cardBytes = await vscode.workspace.fs.readFile(cardUri);
  const cardText = new TextDecoder().decode(cardBytes);
  let card;

  try {
    card = parseCard(cardText);
  } catch (error) {
    const message =
      error instanceof CardParseError
        ? error.message
        : '참조 카드를 읽을 수 없어 rename을 적용할 수 없습니다.';
    throw new CardRenameValidationError(message);
  }

  const updatedCard = rewriteCardIdReferences(card, oldId, newId);

  if (updatedCard === card) {
    return;
  }

  replaceFileText(edit, cardUri, serializeCard(updatedCard), cardText);
}

async function appendProfileImageRename(
  edit: vscode.WorkspaceEdit,
  candidate: CardRenameCandidate,
): Promise<void> {
  const oldProfileUri = characterProfilePath(candidate.workspaceRoot, candidate.oldId);
  const newProfileUri = characterProfilePath(candidate.workspaceRoot, candidate.newId);

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
  const lines = currentText.split('\n');
  const endLine = Math.max(lines.length - 1, 0);
  const endCharacter = lines.at(-1)?.length ?? 0;

  edit.replace(
    uri,
    new vscode.Range(new vscode.Position(0, 0), new vscode.Position(endLine, endCharacter)),
    nextText,
  );
}
