import type { WorkspaceRepositories } from '#engine/application/engineServices';
import { canonicalNotionPageUrl, type StoryUri, type NoteBundle } from '@storyboard/story-model';

import { failedResult, type IUseCase, type UseCaseFailure } from '#engine/application/useCase';
import {
  NoteSourceError,
  type CollectedNotes,
  type INoteSource,
  type NoteLocation,
} from './noteSource';

export interface CollectNotesRequest {
  readonly workspaceRoot: StoryUri;
  readonly location: NoteLocation;
}

export type CollectNotesResult =
  | { readonly ok: true; readonly bundle: NoteBundle }
  | UseCaseFailure;

export class CollectNotesUseCase implements IUseCase<CollectNotesRequest, CollectNotesResult> {
  public constructor(private readonly repositories: WorkspaceRepositories) {}

  public async execute(request: CollectNotesRequest): Promise<CollectNotesResult> {
    const { workspaceRoot, location } = request;

    try {
      const source: INoteSource = await this.repositories.noteSources.open(location);
      const collected: CollectedNotes = await source.collect();

      if (collected.notes.length === 0) {
        return failedResult(new Error('읽을 노트가 없습니다.'));
      }

      const bundle: NoteBundle = {
        kind: source.kind,
        location:
          location.kind === 'obsidian'
            ? location.root.fsPath
            : location.kind === 'notion-export'
              ? location.archive.fsPath
              : canonicalNotionPageUrl(location.pageUrl),
        collectedAt: new Date().toISOString(),
        notes: [...collected.notes],
        skipped: [...collected.skipped],
      };

      await this.repositories.noteAbsorb.saveBundle(workspaceRoot, bundle);

      return { ok: true, bundle };
    } catch (error) {
      if (error instanceof NoteSourceError) {
        return failedResult(error);
      }

      throw error;
    }
  }
}
