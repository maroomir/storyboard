import type { IExtensionCommand } from '@/presentation/commands/extensionCommand';
import * as vscode from 'vscode';

import type { CardManager } from '@storyboard/story-app';
import { getTargetWorkspaceFolder } from '@/infrastructure/vscode/workspace';
import { createEmptyBackground, createEmptyCharacter } from '@storyboard/story-model';
import type { StoryboardCard, StoryUri } from '@storyboard/story-model';
import { cardEditorViewType } from '@/contributionIds';
import { suggestCardId, validateCardId } from '@/presentation/commands/createCard';

export interface CreateCardCommandDependencies {
  readonly cards: Pick<CardManager, 'exists' | 'write'>;
}

export abstract class CreateCardCommandBase implements IExtensionCommand {
  public abstract readonly id: string;

  protected constructor(private readonly dependencies: CreateCardCommandDependencies) {}

  public abstract run(...args: never[]): unknown;

  protected async create(cardType: StoryboardCard['type']): Promise<void> {
    const workspaceFolder: vscode.WorkspaceFolder | undefined = await getTargetWorkspaceFolder();

    if (!workspaceFolder) {
      return;
    }

    const name: string | undefined = await vscode.window.showInputBox({
      title: cardType === 'character' ? '새 캐릭터 이름' : '새 배경 이름',
      prompt: '카드에 표시할 이름을 입력하세요.',
      ignoreFocusOut: true,
      validateInput: (value) => (value.trim().length === 0 ? '이름을 입력해 주세요.' : undefined),
    });

    if (!name) {
      return;
    }

    const id: string | undefined = await vscode.window.showInputBox({
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

    const card: StoryboardCard = createEmptyCard(cardType, id, name);
    if (await this.dependencies.cards.exists(workspaceFolder.uri, card.type, card.id)) {
      await vscode.window.showWarningMessage(`이미 존재하는 카드입니다: ${id}`);
      return;
    }

    const cardUri: StoryUri = await this.dependencies.cards.write(workspaceFolder.uri, card);
    await vscode.commands.executeCommand('vscode.openWith', cardUri, cardEditorViewType);
  }
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
