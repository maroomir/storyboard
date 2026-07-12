import type { IDraftRepository } from '../../../application/ports/repositories';
import type { IFileSystem } from '../../../application/ports/file-system';
import type { Draft } from '../../../domain/Draft';
import { writeDraftFile } from '../../../files/draft';

export class DraftRepository implements IDraftRepository {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async write(uri: unknown, draft: Draft): Promise<void> {
    await writeDraftFile(uri, this.fileSystem, draft);
  }
}
