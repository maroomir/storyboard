import {
  getStoryboardProjectPaths,
  isIgnoredSampleCardFileName,
  isCharacterRole,
  joinCardText,
  parseCard,
} from '@storyboard/story-model';
import { listCardFileUris } from '#engine/persistence/cardFiles';
import type {
  StoryUri,
  CardType,
  SidebarCardSummary,
  StoryboardProjectPaths,
  StoryboardCard,
  CharacterRole,
  BibleSubjectKind,
} from '@storyboard/story-model';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type { ICardSidebarRepository } from '#engine/application/cards/cardSidebarRepository';

export class CardSidebarRepository implements ICardSidebarRepository {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async list(
    workspaceRoot: StoryUri,
    category: BibleSubjectKind,
  ): Promise<SidebarCardSummary[]> {
    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceRoot);
    const directory: StoryUri =
      category === 'character' ? paths.characterDirectory : paths.backgroundDirectory;
    const uris: StoryUri[] = await listCardFileUris(this.fileSystem, directory);
    const summaries: SidebarCardSummary[] = await Promise.all(
      uris
        .filter((uri) => !isIgnoredSampleCardFileName(uri.path.split('/').at(-1) ?? ''))
        .map(async (uri) => await this.toSummary(uri, category)),
    );

    return summaries.sort((left, right) => left.name.localeCompare(right.name, 'ko'));
  }

  private async toSummary(uri: StoryUri, category: BibleSubjectKind): Promise<SidebarCardSummary> {
    try {
      const card: StoryboardCard = parseCard(
        new TextDecoder().decode(await this.fileSystem.readFile(uri)),
      );

      if (this.toCategory(card.type) !== category) {
        return this.errorSummary(uri, category, `Expected ${category} card, got ${card.type}.`);
      }

      const role: CharacterRole | undefined =
        card.type === 'character' && isCharacterRole(card.role) ? card.role : undefined;
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
    uri: StoryUri,
    category: BibleSubjectKind,
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

  private toCategory(cardType: CardType): BibleSubjectKind {
    return cardType === 'character' ? 'character' : 'background';
  }
}
