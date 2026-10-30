import type { HostAdapters } from '#engine/application/engineServices';

import {
  NoteSourceError,
  type INoteSource,
  type INoteSourceProvider,
  type NoteLocation,
} from '#engine/application/notes/noteSource';
import { NotionExportNoteSource } from '#engine/persistence/notes/notionExportNoteSource';
import { NotionNoteSource, type NoteHttpFetch } from '#engine/persistence/notes/notionNoteSource';
import { ObsidianNoteSource } from '#engine/persistence/notes/obsidianNoteSource';

export interface NoteSourceProviderCollaborators {
  readonly fetch: NoteHttpFetch;
}

export class NoteSourceProvider implements INoteSourceProvider {
  public constructor(
    private readonly host: HostAdapters,
    private readonly collaborators: NoteSourceProviderCollaborators,
  ) {}

  public async open(location: NoteLocation): Promise<INoteSource> {
    if (location.kind === 'obsidian') {
      return new ObsidianNoteSource({ fileSystem: this.host.fileSystem, root: location.root });
    }

    if (location.kind === 'notion-export') {
      return new NotionExportNoteSource({
        fileSystem: this.host.fileSystem,
        archive: location.archive,
      });
    }

    const token: string | undefined = await this.host.secretStore.getNotionToken();

    if (token === undefined) {
      throw new NoteSourceError(
        'missing-token',
        'Notion 토큰이 없습니다. storyboard notes connect notion 으로 먼저 넣어 주세요.',
      );
    }

    return new NotionNoteSource({
      pageUrl: location.pageUrl,
      token,
      fetch: this.collaborators.fetch,
    });
  }
}
