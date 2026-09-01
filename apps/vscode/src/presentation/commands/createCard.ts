import * as vscode from 'vscode';

import type { CreateCardUseCase } from '@storyboard/story-engine';
import { getTargetWorkspaceFolder } from '@/infrastructure/vscode/workspace';
import { createEmptyBackground, createEmptyCharacter } from '@storyboard/story-format';
import { cardIdPattern } from '@storyboard/story-format';
import type { StoryboardCard } from '@storyboard/story-format';

const createCharacterCommand = 'storyboard.character.create';
const createBackgroundCommand = 'storyboard.background.create';
const cardEditorViewType = 'storyboard.card';
export function registerCreateCardCommands(dependencies: {
  readonly createCardUseCase: CreateCardUseCase;
}): vscode.Disposable {
  return vscode.Disposable.from(
    vscode.commands.registerCommand(createCharacterCommand, () =>
      createCard('character', dependencies.createCardUseCase),
    ),
    vscode.commands.registerCommand(createBackgroundCommand, () =>
      createCard('location', dependencies.createCardUseCase),
    ),
  );
}

async function createCard(
  cardType: StoryboardCard['type'],
  createCardUseCase: CreateCardUseCase,
): Promise<void> {
  const workspaceFolder = await getTargetWorkspaceFolder();

  if (!workspaceFolder) {
    return;
  }

  const name = await vscode.window.showInputBox({
    title: cardType === 'character' ? '새 캐릭터 이름' : '새 배경 이름',
    prompt: '카드에 표시할 이름을 입력하세요.',
    ignoreFocusOut: true,
    validateInput: (value) => (value.trim().length === 0 ? '이름을 입력해 주세요.' : undefined),
  });

  if (!name) {
    return;
  }

  const id = await vscode.window.showInputBox({
    title: cardType === 'character' ? '새 캐릭터 ID' : '새 배경 ID',
    prompt:
      '파일명과 참조에 사용할 ID를 입력하세요. 영문 소문자, 숫자, 하이픈만 사용할 수 있습니다.',
    value: suggestCardId(name),
    ignoreFocusOut: true,
    validateInput: validateCardId,
  });

  if (!id) {
    return;
  }

  const card = createEmptyCard(cardType, id, name);
  if (await createCardUseCase.exists(workspaceFolder.uri, card.type, card.id)) {
    await vscode.window.showWarningMessage(`이미 존재하는 카드입니다: ${id}`);
    return;
  }

  const cardUri = await createCardUseCase.write(workspaceFolder.uri, card);
  await vscode.commands.executeCommand('vscode.openWith', cardUri, cardEditorViewType);
}

export function needsCardIdPrompt(name: string): boolean {
  return suggestCardId(name) === fallbackCardId;
}

function createEmptyCard(
  cardType: StoryboardCard['type'],
  id: string,
  name: string,
): StoryboardCard {
  if (cardType === 'character') {
    return createEmptyCharacter(id, name);
  }

  return createEmptyBackground(id, name);
}

export function validateCardId(value: string): string | undefined {
  const id = value.trim();

  if (id.length === 0) {
    return 'ID를 입력해 주세요.';
  }

  if (!cardIdPattern.test(id)) {
    return 'ID는 영문 소문자, 숫자, 하이픈만 사용할 수 있고 숫자/문자로 시작해야 합니다.';
  }

  return undefined;
}

const fallbackCardId = 'new-card';

export function suggestCardId(name: string): string {
  const normalizedName = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalizedName.length > 0 ? normalizedName : fallbackCardId;
}
