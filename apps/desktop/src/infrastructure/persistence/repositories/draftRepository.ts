import type { IDraftRepository } from '../../../application/ports/repositories';
import type { IFileSystem } from '../../../application/ports/fileSystem';
import { writeDraftFile } from '@storyboard/story-format';
import type { Draft } from '@storyboard/story-format';
export class DraftRepository implements IDraftRepository {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async write(uri: unknown, draft: Draft): Promise<void> {
    await writeDraftFile(uri, this.fileSystem, draft);
  }
}
