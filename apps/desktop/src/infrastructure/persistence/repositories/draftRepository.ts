import type { IDraftRepository } from '../../../application/ports/repositories';
import type { IFileSystem } from '../../../application/ports/fileSystem';
import { writeDraftFile } from '@/domain/files/storyFiles';
import type { Draft } from '@seedkernel/wasm';
export class DraftRepository implements IDraftRepository {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async write(uri: unknown, draft: Draft): Promise<void> {
    await writeDraftFile(uri, this.fileSystem, draft);
  }
}
