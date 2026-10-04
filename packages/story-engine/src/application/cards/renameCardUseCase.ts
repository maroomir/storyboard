import {
  cardIdPattern,
  getStoryboardProjectPaths,
  isIgnoredSampleCardFileName,
  joinStoryPath,
  parseCard,
  rewriteCardIdReferences,
  serializeCard,
  setCardId,
  type StoryUri,
} from '@storyboard/story-model';

import type { IFileSystem } from '#engine/ports/fileSystem';
import type { IStoryboardLogger } from '#engine/ports/logger';
import { listCardFileUris } from '#engine/persistence/cardFiles';
import { runUseCase, type IUseCase, type UseCaseFailure } from '#engine/application/useCase';
import type { SidebarCardCategory } from './cardSidebarRepository';

export interface RenameCardRequest {
  readonly workspaceRoot: StoryUri;
  readonly category: SidebarCardCategory;
  readonly fromId: string;
  readonly toId: string;
}

export type RenameCardResult =
  | {
      readonly ok: true;
      readonly kind: 'renamed';
      readonly fromId: string;
      readonly toId: string;
      // Cards whose references to the old id were rewritten.
      readonly rewrittenCount: number;
      // Cards that could not be parsed, so their references were left as they were.
      readonly unreadableFiles: readonly string[];
    }
  | {
      readonly ok: false;
      readonly kind: 'invalid-id' | 'missing' | 'exists';
      readonly message: string;
    }
  | UseCaseFailure;

export interface RenameCardUseCaseDependencies {
  readonly fileSystem: IFileSystem;
  readonly logger: IStoryboardLogger;
}

// Renaming a card is a workspace-wide edit: the file moves, its own id changes, and every card
// that references it is rewritten. The writes are sequential, so a crash mid-rename leaves
// references half-updated — run it on a clean tree.
export class RenameCardUseCase implements IUseCase<RenameCardRequest, RenameCardResult> {
  public constructor(private readonly deps: RenameCardUseCaseDependencies) {}

  public async execute(request: RenameCardRequest): Promise<RenameCardResult> {
    return await runUseCase<RenameCardResult>(this.deps.logger, 'Rename card failed', () =>
      this.rename(request),
    );
  }

  private async rename(request: RenameCardRequest): Promise<RenameCardResult> {
    const { fileSystem } = this.deps;
    const { workspaceRoot, category, fromId, toId } = request;

    if (!cardIdPattern.test(toId)) {
      return {
        ok: false,
        kind: 'invalid-id',
        message: 'ID 는 영문 소문자, 숫자, 하이픈만 쓸 수 있고 숫자나 문자로 시작해야 합니다.',
      };
    }

    const paths = getStoryboardProjectPaths(workspaceRoot);
    const directory =
      category === 'character' ? paths.characterDirectory : paths.backgroundDirectory;
    const fromUri = joinStoryPath(directory, `${fromId}.card`);
    const toUri = joinStoryPath(directory, `${toId}.card`);

    if (!(await fileSystem.exists(fromUri))) {
      return { ok: false, kind: 'missing', message: `카드가 없습니다: ${fromId}` };
    }

    if (await fileSystem.exists(toUri)) {
      return { ok: false, kind: 'exists', message: `이미 있습니다: ${toId}` };
    }

    const renamed = setCardId(
      parseCard(new TextDecoder().decode(await fileSystem.readFile(fromUri))),
      toId,
    );

    await fileSystem.writeFile(toUri, new TextEncoder().encode(serializeCard(renamed)));
    await fileSystem.delete(fromUri);

    // Only a character id is referenced from other cards; a background id is not.
    const references =
      category === 'character'
        ? await this.rewriteReferences(
            [paths.characterDirectory, paths.backgroundDirectory],
            toUri,
            fromId,
            toId,
          )
        : { rewrittenCount: 0, unreadableFiles: [] };

    return { ok: true, kind: 'renamed', fromId, toId, ...references };
  }

  private async rewriteReferences(
    directories: readonly StoryUri[],
    renamedUri: StoryUri,
    fromId: string,
    toId: string,
  ): Promise<{ readonly rewrittenCount: number; readonly unreadableFiles: readonly string[] }> {
    const { fileSystem } = this.deps;
    const unreadableFiles: string[] = [];
    let rewrittenCount = 0;

    for (const directory of directories) {
      for (const uri of await listCardFileUris(fileSystem, directory)) {
        const fileName = uri.path.split('/').at(-1) ?? '';

        if (uri.path === renamedUri.path || isIgnoredSampleCardFileName(fileName)) {
          continue;
        }

        const raw = new TextDecoder().decode(await fileSystem.readFile(uri));
        let next: string;

        try {
          next = serializeCard(rewriteCardIdReferences(parseCard(raw), fromId, toId));
        } catch {
          // One unreadable card must not abort a rename that already moved the file. It is named
          // in the result; the operator fixes that card and renames the reference by hand.
          unreadableFiles.push(uri.path);
          continue;
        }

        if (next !== raw) {
          await fileSystem.writeFile(uri, new TextEncoder().encode(next));
          rewrittenCount += 1;
        }
      }
    }

    return { rewrittenCount, unreadableFiles };
  }
}
