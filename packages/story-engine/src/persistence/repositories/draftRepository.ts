import type { StoryUri, Draft } from '@storyboard/story-model';
import type { IDraftRepository } from '#engine/application/drafts/draftRepositories';
import type { IFileSystem } from '#engine/ports/fileSystem';
import { writeDraftFile } from '@storyboard/story-model';
export class DraftRepository implements IDraftRepository {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async write(uri: StoryUri, draft: Draft): Promise<void> {
    await writeDraftFile(uri, this.fileSystem, draft);
  }
}
