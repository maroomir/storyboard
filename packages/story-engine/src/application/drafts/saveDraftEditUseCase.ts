import type { HostAdapters } from '#engine/application/engineServices';
import {
  parseDraft,
  serializeDraft,
  type StoryUri,
  draftPath,
  type Draft,
} from '@storyboard/story-model';
import {
  DraftHistoryArchiver,
  type DraftArchivePolicy,
} from '#engine/application/drafts/draftHistoryArchiver';

import type { IUseCase } from '#engine/application/useCase';

export interface SaveDraftEditRequest {
  readonly workspaceRoot: StoryUri;
  readonly sceneStem: string;
  readonly body: string;
  readonly archive?: DraftArchivePolicy;
}

export type SaveDraftEditResult =
  | { readonly ok: true; readonly kind: 'saved'; readonly archivedAs?: string }
  | { readonly ok: true; readonly kind: 'unchanged' }
  | { readonly ok: false; readonly kind: 'missing' };

export class SaveDraftEditUseCase implements IUseCase<SaveDraftEditRequest, SaveDraftEditResult> {
  private readonly archiver: DraftHistoryArchiver;

  public constructor(private readonly host: HostAdapters) {
    this.archiver = new DraftHistoryArchiver(host);
  }

  public async execute(request: SaveDraftEditRequest): Promise<SaveDraftEditResult> {
    const draftUri: StoryUri = draftPath(request.workspaceRoot, request.sceneStem);

    if (!(await this.host.fileSystem.exists(draftUri))) {
      return { ok: false, kind: 'missing' };
    }

    const existing: Draft = parseDraft(
      new TextDecoder().decode(await this.host.fileSystem.readFile(draftUri)),
    );

    if (existing.body === request.body) {
      return { ok: true, kind: 'unchanged' };
    }

    const archivedAs: string | undefined = this.archiver.shouldArchive(
      request.archive ?? 'per-setting',
    )
      ? await this.archiver.archive(request.workspaceRoot, request.sceneStem)
      : undefined;

    await this.host.fileSystem.writeFile(
      draftUri,
      new TextEncoder().encode(serializeDraft({ ...existing, body: request.body })),
    );

    return archivedAs === undefined
      ? { ok: true, kind: 'saved' }
      : { ok: true, kind: 'saved', archivedAs };
  }
}
