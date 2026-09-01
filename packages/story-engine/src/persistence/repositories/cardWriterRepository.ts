import type { StoryUri } from '@storyboard/story-format';
import type { IFileSystem } from '../../ports/fileSystem';
import type { ICardWriterRepository } from '../../application/cards/createCardUseCase';
import {
  backgroundCardPath,
  characterCardPath,
  characterProfilePath,
} from '../../paths/projectPaths';
import { serializeCard } from '@storyboard/story-format';
import type { StoryboardCard } from '@storyboard/story-format';
const TRANSPARENT_PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

export class CardWriterRepository implements ICardWriterRepository {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async exists(
    workspaceRoot: StoryUri,
    cardType: StoryboardCard['type'],
    id: string,
  ): Promise<boolean> {
    return await this.fileSystem.exists(this.cardUri(workspaceRoot, cardType, id));
  }

  public async write(workspaceRoot: StoryUri, card: StoryboardCard): Promise<StoryUri> {
    const cardUri = this.cardUri(workspaceRoot, card.type, card.id);
    await this.fileSystem.writeFile(cardUri, new TextEncoder().encode(serializeCard(card)));

    if (card.type === 'character') {
      const imageUri = characterProfilePath(workspaceRoot, card.id);
      if (!(await this.fileSystem.exists(imageUri))) {
        await this.fileSystem.writeFile(imageUri, TRANSPARENT_PNG_BYTES);
      }
    }

    return cardUri;
  }

  private cardUri(workspaceRoot: StoryUri, cardType: StoryboardCard['type'], id: string): StoryUri {
    return cardType === 'character'
      ? characterCardPath(workspaceRoot, id)
      : backgroundCardPath(workspaceRoot, id);
  }
}
