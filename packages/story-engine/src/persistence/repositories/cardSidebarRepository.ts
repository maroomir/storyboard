import {
  backgroundCardPath,
  characterCardPath,
  getStoryboardProjectPaths,
  isCharacterRole,
  joinCardText,
} from '@storyboard/story-model';
import type {
  BibleSubjectKind,
  CharacterRole,
  SidebarCardSummary,
  StoryboardCard,
  StoryUri,
} from '@storyboard/story-model';
import type { ICardSidebarRepository } from '#engine/application/cards/cardSidebarRepository';
import type { CardRoster, WorkspaceCards } from '#engine/persistence/bundles/workspaceCards';

export class CardSidebarRepository implements ICardSidebarRepository {
  public constructor(private readonly cards: WorkspaceCards) {}

  public async list(
    workspaceRoot: StoryUri,
    category: BibleSubjectKind,
  ): Promise<SidebarCardSummary[]> {
    let roster: CardRoster;
    try {
      roster = await this.cards.loadRoster(workspaceRoot, [category]);
    } catch (error) {
      return [this.errorSummary(workspaceRoot, category, error)];
    }

    const cards: readonly StoryboardCard[] =
      category === 'character' ? roster.characters : roster.backgrounds;
    return cards
      .map((card) => this.toSummary(workspaceRoot, card))
      .sort((left, right) => left.name.localeCompare(right.name, 'ko'));
  }

  private toSummary(workspaceRoot: StoryUri, card: StoryboardCard): SidebarCardSummary {
    const role: CharacterRole | undefined =
      card.type === 'character' && isCharacterRole(card.role) ? card.role : undefined;
    const uri: StoryUri =
      card.type === 'character'
        ? characterCardPath(workspaceRoot, card.id)
        : backgroundCardPath(workspaceRoot, card.id);

    return {
      type: card.type,
      id: card.id,
      name: card.name,
      uri: uri.toString(),
      description: joinCardText(card.description),
      ...(role ? { role } : {}),
    };
  }

  private errorSummary(
    workspaceRoot: StoryUri,
    category: BibleSubjectKind,
    error: unknown,
  ): SidebarCardSummary {
    const directory: StoryUri =
      category === 'character'
        ? getStoryboardProjectPaths(workspaceRoot).characterDirectory
        : getStoryboardProjectPaths(workspaceRoot).backgroundDirectory;

    return {
      type: category === 'character' ? 'character' : 'location',
      id: directory.path,
      name: directory.path.split('/').at(-1) ?? directory.toString(),
      uri: directory.toString(),
      error: error instanceof Error ? error.message : '카드를 읽을 수 없습니다.',
    };
  }
}
