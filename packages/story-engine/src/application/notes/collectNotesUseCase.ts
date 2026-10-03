import type { StoryUri, NoteBundle } from '@storyboard/story-model';

import { failedResult, type IUseCase, type UseCaseFailure } from '#engine/application/useCase';
import type { INoteAbsorbRepository } from './noteAbsorbRepository';
import { NoteSourceError, type INoteSourceProvider, type NoteLocation } from './noteSource';

export interface CollectNotesRequest {
  readonly workspaceRoot: StoryUri;
  readonly location: NoteLocation;
}

export type CollectNotesResult =
  | { readonly ok: true; readonly bundle: NoteBundle }
  | UseCaseFailure;

export interface CollectNotesUseCaseDependencies {
  readonly sources: INoteSourceProvider;
  readonly repository: INoteAbsorbRepository;
}

// Reads the notes and nothing else: no AI call is made here, so a caller can show what was found
// and what it would cost before anything is spent.
export class CollectNotesUseCase implements IUseCase<CollectNotesRequest, CollectNotesResult> {
  public constructor(private readonly deps: CollectNotesUseCaseDependencies) {}

  public async execute(request: CollectNotesRequest): Promise<CollectNotesResult> {
    const { workspaceRoot, location } = request;

    try {
      const source = await this.deps.sources.open(location);
      const collected = await source.collect();

      if (collected.notes.length === 0) {
        return failedResult(new Error('읽을 노트가 없습니다.'));
      }

      const bundle: NoteBundle = {
        kind: source.kind,
        location: location.kind === 'obsidian' ? location.root.fsPath : location.pageUrl,
        collectedAt: new Date().toISOString(),
        notes: [...collected.notes],
        skipped: [...collected.skipped],
      };

      await this.deps.repository.saveBundle(workspaceRoot, bundle);

      return { ok: true, bundle };
    } catch (error) {
      if (error instanceof NoteSourceError) {
        return failedResult(error);
      }

      throw error;
    }
  }
}
