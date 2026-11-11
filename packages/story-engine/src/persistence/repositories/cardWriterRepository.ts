import type { StatementSource, StoryUri, StoryboardCard } from '@storyboard/story-model';
import { characterProfilePath } from '@storyboard/story-model';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type { ICardWriterRepository } from '#engine/application/cards/cardRepositories';
import type { WorkspaceCards } from '#engine/persistence/bundles/workspaceCards';
const TRANSPARENT_PNG_BYTES: Uint8Array<ArrayBuffer> = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

const studioSource: StatementSource = { origin: 'studio' };

export class CardWriterRepository implements ICardWriterRepository {
  public constructor(
    private readonly fileSystem: IFileSystem,
    private readonly cards: WorkspaceCards,
  ) {}

  public async exists(
    workspaceRoot: StoryUri,
    cardType: StoryboardCard['type'],
    id: string,
  ): Promise<boolean> {
    return await this.cards.exists(
      workspaceRoot,
      cardType === 'character' ? 'character' : 'background',
      id,
    );
  }

  public async write(workspaceRoot: StoryUri, card: StoryboardCard): Promise<StoryUri> {
    const [cardUri] = await this.writeAll(workspaceRoot, [card]);
    if (cardUri === undefined) {
      throw new Error(`카드를 쓰지 못했습니다: ${card.id}`);
    }

    return cardUri;
  }

  public async writeAll(
    workspaceRoot: StoryUri,
    cards: readonly StoryboardCard[],
  ): Promise<readonly StoryUri[]> {
    const cardUris: StoryUri[] = await this.cards.writeCards(workspaceRoot, cards, studioSource);

    for (const card of cards.filter((candidate) => candidate.type === 'character')) {
      await this.writeProfilePlaceholderIfMissing(workspaceRoot, card.id);
    }

    return cardUris;
  }

  private async writeProfilePlaceholderIfMissing(
    workspaceRoot: StoryUri,
    slug: string,
  ): Promise<void> {
    const imageUri: StoryUri = characterProfilePath(workspaceRoot, slug);
    if (!(await this.fileSystem.exists(imageUri))) {
      await this.fileSystem.writeFile(imageUri, TRANSPARENT_PNG_BYTES);
    }
  }
}
