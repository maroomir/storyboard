import {
  parseDraft,
  serializeDraft,
  type StoryUri,
  archiveExistingDraft,
  draftHistorySceneDirectory,
  draftPath,
  joinUri,
  type Draft,
} from '@storyboard/story-model';

import type { IFileSystem } from '#engine/ports/fileSystem';
import type { IUseCase } from '#engine/application/useCase';

export interface SaveDraftEditRequest {
  readonly workspaceRoot: StoryUri;
  readonly sceneStem: string;
  readonly body: string;
  readonly archivePrevious: boolean;
}

export type SaveDraftEditResult =
  | { readonly ok: true; readonly kind: 'saved'; readonly archivedAs?: string }
  | { readonly ok: true; readonly kind: 'unchanged' }
  | { readonly ok: false; readonly kind: 'missing' };

export interface SaveDraftEditUseCaseDependencies {
  readonly fileSystem: IFileSystem;
}

export class SaveDraftEditUseCase implements IUseCase<SaveDraftEditRequest, SaveDraftEditResult> {
  public constructor(private readonly deps: SaveDraftEditUseCaseDependencies) {}

  public async execute(request: SaveDraftEditRequest): Promise<SaveDraftEditResult> {
    const draftUri: StoryUri = draftPath(request.workspaceRoot, request.sceneStem);

    if (!(await this.deps.fileSystem.exists(draftUri))) {
      return { ok: false, kind: 'missing' };
    }

    const existing: Draft = parseDraft(
      new TextDecoder().decode(await this.deps.fileSystem.readFile(draftUri)),
    );

    if (existing.body === request.body) {
      return { ok: true, kind: 'unchanged' };
    }

    const archivedAs: string | undefined = request.archivePrevious
      ? await this.archive(request.workspaceRoot, request.sceneStem, draftUri)
      : undefined;

    await this.deps.fileSystem.writeFile(
      draftUri,
      new TextEncoder().encode(serializeDraft({ ...existing, body: request.body })),
    );

    return archivedAs === undefined
      ? { ok: true, kind: 'saved' }
      : { ok: true, kind: 'saved', archivedAs };
  }

  private async archive(
    workspaceRoot: StoryUri,
    sceneStem: string,
    draftUri: StoryUri,
  ): Promise<string | undefined> {
    const historyDirectory: StoryUri = draftHistorySceneDirectory(workspaceRoot, sceneStem);

    return await archiveExistingDraft({
      draftUri,
      historyDirectory,
      resolveArchiveUri: (fileName) => joinUri(historyDirectory, fileName),
      fileSystem: this.deps.fileSystem,
    });
  }
}
