import type { SecretStore } from '@storyboard/story-ai';

import {
  NoteSourceError,
  type INoteSource,
  type INoteSourceProvider,
  type NoteLocation,
} from '#engine/application/notes/noteSource';
import type { IFileSystem } from '#engine/ports/fileSystem';
import { NotionNoteSource, type NoteHttpFetch } from './notionNoteSource';
import { ObsidianNoteSource } from './obsidianNoteSource';

export interface NoteSourceProviderDependencies {
  readonly fileSystem: IFileSystem;
  readonly secretStore: SecretStore;
  readonly fetch: NoteHttpFetch;
}

export class NoteSourceProvider implements INoteSourceProvider {
  public constructor(private readonly deps: NoteSourceProviderDependencies) {}

  public async open(location: NoteLocation): Promise<INoteSource> {
    if (location.kind === 'obsidian') {
      return new ObsidianNoteSource({ fileSystem: this.deps.fileSystem, root: location.root });
    }

    const token = await this.deps.secretStore.getNotionToken();

    if (token === undefined) {
      throw new NoteSourceError(
        'missing-token',
        'Notion 토큰이 없습니다. storyboard notes connect notion 으로 먼저 넣어 주세요.',
      );
    }

    return new NotionNoteSource({ pageUrl: location.pageUrl, token, fetch: this.deps.fetch });
  }
}
