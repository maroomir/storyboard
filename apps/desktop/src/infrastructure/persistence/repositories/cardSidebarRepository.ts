import * as vscode from 'vscode';

import type {
  ICardSidebarRepository,
  SidebarCardCategory,
} from '../../../application/cards/cardSidebarRepository';
import { isIgnoredSampleCardFileName } from '../../vscode/pathConventions';
import { isCharacterRole, joinCardText, parseCard } from '@seedkernel/wasm';
import type { CardType } from '@seedkernel/wasm';
import type { SidebarCardSummary } from '../../../shared/messaging';

export class CardSidebarRepository implements ICardSidebarRepository {
  public async list(
    workspaceRoot: vscode.Uri,
    category: SidebarCardCategory,
  ): Promise<SidebarCardSummary[]> {
    const glob = category === 'character' ? 'character/*.card' : 'background/*.card';
    const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(workspaceRoot, glob));
    const summaries = await Promise.all(
      uris
        .filter((uri) => !isIgnoredSampleCardFileName(uri.path.split('/').at(-1) ?? ''))
        .map(async (uri) => await this.toSummary(uri, category)),
    );

    return summaries.sort((left, right) => left.name.localeCompare(right.name, 'ko'));
  }

  private async toSummary(
    uri: vscode.Uri,
    category: SidebarCardCategory,
  ): Promise<SidebarCardSummary> {
    try {
      const card = parseCard(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)));

      if (this.toCategory(card.type) !== category) {
        return this.errorSummary(uri, category, `Expected ${category} card, got ${card.type}.`);
      }

      const role = card.type === 'character' && isCharacterRole(card.role) ? card.role : undefined;
      return {
        type: card.type,
        id: card.id,
        name: card.name,
        uri: uri.toString(),
        description: joinCardText(card.description),
        ...(role ? { role } : {}),
      };
    } catch (error) {
      return this.errorSummary(
        uri,
        category,
        error instanceof Error ? error.message : '카드를 읽을 수 없습니다.',
      );
    }
  }

  private errorSummary(
    uri: vscode.Uri,
    category: SidebarCardCategory,
    error: string,
  ): SidebarCardSummary {
    return {
      type: category === 'character' ? 'character' : 'location',
      id: uri.path,
      name: uri.path.split('/').at(-1) ?? uri.toString(),
      uri: uri.toString(),
      error,
    };
  }

  private toCategory(cardType: CardType): SidebarCardCategory {
    return cardType === 'character' ? 'character' : 'background';
  }
}
