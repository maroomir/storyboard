import type { IDraftRepository } from '@storyboard/story-engine';
import type { IFileSystem } from '@storyboard/story-engine';
import { writeDraftFile } from '@storyboard/story-format';
import type { Draft } from '@storyboard/story-format';
export class DraftRepository implements IDraftRepository {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async write(uri: unknown, draft: Draft): Promise<void> {
    await writeDraftFile(uri, this.fileSystem, draft);
  }
}
