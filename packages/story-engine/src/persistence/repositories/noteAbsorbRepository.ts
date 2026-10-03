import type { StoryUri } from '@storyboard/story-format';

import type { INoteAbsorbRepository } from '#engine/application/notes/noteAbsorbRepository';
import { getStoryboardProjectPaths } from '#engine/paths/projectPaths';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type { NoteBundle } from '#engine/shared/noteAbsorb';

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
}

export class NoteAbsorbRepository implements INoteAbsorbRepository {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async saveBundle(workspaceRoot: StoryUri, bundle: NoteBundle): Promise<void> {
    const paths = getStoryboardProjectPaths(workspaceRoot);

    await this.fileSystem.createDirectory(paths.noteCacheDirectory);
    await this.fileSystem.writeFile(paths.noteSource, encodeJson(bundle));
  }
}
