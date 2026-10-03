import {
  parseDraft,
  serializeDraft,
  type StoryUri,
  archiveExistingDraft,
  draftHistorySceneDirectory,
  draftPath,
  joinUri,
} from '@storyboard/story-model';

import type { IFileSystem } from '#engine/ports/fileSystem';
import type { IUseCase } from '#engine/application/useCase';

export interface SaveDraftEditRequest {
  readonly workspaceRoot: StoryUri;
  readonly sceneStem: string;
  readonly body: string;
  // The first save of an editing session keeps the version it started from in `.draft/`. Later
  // saves in the same session overwrite quietly, so autosave does not flood the history.
  readonly archivePrevious: boolean;
}

export type SaveDraftEditResult =
  | { readonly ok: true; readonly kind: 'saved'; readonly archivedAs?: string }
  | { readonly ok: true; readonly kind: 'unchanged' }
  | { readonly ok: false; readonly kind: 'missing' };

// A person's edit to a generated draft. The frontmatter stays as generated; only the body changes.
// A later regeneration sees that the body no longer matches its cache record and archives the
// edited version before writing, so a hand edit is never overwritten without a copy.
export interface SaveDraftEditUseCaseDependencies {
  readonly fileSystem: IFileSystem;
}

export class SaveDraftEditUseCase implements IUseCase<SaveDraftEditRequest, SaveDraftEditResult> {
  public constructor(private readonly deps: SaveDraftEditUseCaseDependencies) {}

  public async execute(request: SaveDraftEditRequest): Promise<SaveDraftEditResult> {
    const draftUri = draftPath(request.workspaceRoot, request.sceneStem);

    if (!(await this.deps.fileSystem.exists(draftUri))) {
      return { ok: false, kind: 'missing' };
    }

    const existing = parseDraft(
      new TextDecoder().decode(await this.deps.fileSystem.readFile(draftUri)),
    );

    if (existing.body === request.body) {
      return { ok: true, kind: 'unchanged' };
    }

    const archivedAs = request.archivePrevious
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
    const historyDirectory = draftHistorySceneDirectory(workspaceRoot, sceneStem);

    return await archiveExistingDraft({
      draftUri,
      historyDirectory,
      resolveArchiveUri: (fileName) => joinUri(historyDirectory, fileName),
      fileSystem: this.deps.fileSystem,
    });
  }
}
