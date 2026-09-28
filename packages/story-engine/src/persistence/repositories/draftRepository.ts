import type { StoryUri } from '@storyboard/story-format';
import type { IDraftRepository } from '#engine/application/drafts/draftRepositories';
import type { IFileSystem } from '#engine/ports/fileSystem';
import { writeDraftFile } from '@storyboard/story-format';
import type { Draft } from '@storyboard/story-format';
export class DraftRepository implements IDraftRepository {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async write(uri: StoryUri, draft: Draft): Promise<void> {
    await writeDraftFile(uri, this.fileSystem, draft);
  }
}
