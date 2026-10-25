import {
  cardIdPattern,
  getStoryboardProjectPaths,
  isIgnoredSampleCardFileName,
  joinStoryPath,
  parseCard,
  rewriteCardIdReferences,
  serializeCard,
  setCardId,
  type BibleSubjectKind,
  type StoryboardCard,
  type StoryboardProjectPaths,
  type StoryUri,
} from '@storyboard/story-model';

import type { IFileSystem } from '#engine/ports/fileSystem';
import type { IStoryboardLogger } from '#engine/ports/logger';
import { listCardFileUris } from '#engine/persistence/cardFiles';
import { runUseCase, type IUseCase, type UseCaseFailure } from '#engine/application/useCase';

export interface RenameCardRequest {
  readonly workspaceRoot: StoryUri;
  readonly category: BibleSubjectKind;
  readonly fromId: string;
  readonly toId: string;
}

export type RenameCardResult =
  | {
      readonly ok: true;
      readonly kind: 'renamed';
      readonly fromId: string;
      readonly toId: string;
      readonly rewrittenCount: number;
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

export interface ReferenceRewrite {
  readonly rewrittenCount: number;
  readonly unreadableFiles: readonly string[];
}

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

    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceRoot);
    const directory: StoryUri =
      category === 'character' ? paths.characterDirectory : paths.backgroundDirectory;
    const fromUri: StoryUri = joinStoryPath(directory, `${fromId}.card`);
    const toUri: StoryUri = joinStoryPath(directory, `${toId}.card`);

    if (!(await fileSystem.exists(fromUri))) {
      return { ok: false, kind: 'missing', message: `카드가 없습니다: ${fromId}` };
    }

    if (await fileSystem.exists(toUri)) {
      return { ok: false, kind: 'exists', message: `이미 있습니다: ${toId}` };
    }

    const renamed: StoryboardCard = setCardId(
      parseCard(new TextDecoder().decode(await fileSystem.readFile(fromUri))),
      toId,
    );

    await fileSystem.writeFile(toUri, new TextEncoder().encode(serializeCard(renamed)));
    await fileSystem.delete(fromUri);

    const references: ReferenceRewrite =
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
  ): Promise<ReferenceRewrite> {
    const { fileSystem } = this.deps;
    const unreadableFiles: string[] = [];
    let rewrittenCount: number = 0;

    for (const directory of directories) {
      for (const uri of await listCardFileUris(fileSystem, directory)) {
        const fileName: string = uri.path.split('/').at(-1) ?? '';

        if (uri.path === renamedUri.path || isIgnoredSampleCardFileName(fileName)) {
          continue;
        }

        const raw: string = new TextDecoder().decode(await fileSystem.readFile(uri));
        let next: string;

        try {
          next = serializeCard(rewriteCardIdReferences(parseCard(raw), fromId, toId));
        } catch {
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
