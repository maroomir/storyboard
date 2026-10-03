import {
  parseBible,
  parseCard,
  parseDraft,
  parseSceneRenameJournal,
  parseStoryState,
  parseSceneFileName,
  parseSceneStem,
  renumberStoryStateScene,
  rewriteBibleSceneReferences,
  rewriteCharacterArcSceneRefs,
  rewriteSceneCardStemText,
  sceneSummaryFileName,
  serializeBible,
  serializeCard,
  serializeDraft,
  serializeSceneRenameJournal,
  serializeStoryState,
  type SceneRename,
  type StoryUri,
} from '@storyboard/story-model';

import { parseRevisionPlan, serializeRevisionPlan } from '#engine/domain/files/revisionPlan';
import {
  draftHistorySceneDirectory,
  draftPath,
  getStoryboardProjectPaths,
  joinUri,
  resolveThreadPaths,
  scenePath,
  type StoryboardProjectPaths,
} from '#engine/paths/projectPaths';
import type { FileSystemDirectoryEntry, IFileSystem } from '#engine/ports/fileSystem';
import type { IStoryboardLogger } from '#engine/ports/logger';
import { runUseCase, type IUseCase, type UseCaseFailure } from '#engine/application/useCase';

export interface RenameSceneRequest {
  readonly workspaceRoot: StoryUri;
  readonly fromStem: string;
  readonly toStem: string;
}

export type RenameSceneResult =
  | {
      readonly ok: true;
      readonly kind: 'renamed';
      readonly fromStem: string;
      readonly toStem: string;
      readonly hasOrderChanged: boolean;
      // Workspace-relative paths, in the order they were written.
      readonly movedFiles: readonly string[];
      readonly rewrittenFiles: readonly string[];
    }
  | {
      readonly ok: false;
      readonly kind: 'invalid-stem' | 'missing' | 'order-taken';
      readonly message: string;
    }
  | UseCaseFailure;

export interface RenameSceneUseCaseDependencies {
  readonly fileSystem: IFileSystem;
  readonly logger: IStoryboardLogger;
}

interface PlannedWrite {
  readonly from?: StoryUri;
  readonly to: StoryUri;
  readonly content: string | Uint8Array;
}

const sceneStemFieldNames = new Set([
  'sceneStem',
  'sourceScene',
  'sceneRef',
  'updatedThroughScene',
]);
const sceneEntityKeyFieldNames = new Set(['id', 'key']);

// Scenes are keyed by their file stem: the card, its summary, the draft and its history, every
// cache and memory file is named after it, and the ledgers and canon refer to it by stem or by
// order. A rename moves and rewrites all of them. Every file is read and transformed before the
// first write, so a file that cannot be parsed stops the rename with nothing changed. A rename
// cut off before it deleted the old card is finished by running the same rename again; the
// journal it wrote first is what marks it as cut off.
export class RenameSceneUseCase implements IUseCase<RenameSceneRequest, RenameSceneResult> {
  public constructor(private readonly deps: RenameSceneUseCaseDependencies) {}

  public async execute(request: RenameSceneRequest): Promise<RenameSceneResult> {
    return await runUseCase(this.deps.logger, 'RenameSceneUseCase', () => this.rename(request));
  }

  private async rename(request: RenameSceneRequest): Promise<RenameSceneResult> {
    const from = parseSceneStem(request.fromStem);
    const to = parseSceneStem(request.toStem);

    if (from === undefined || to === undefined) {
      return {
        ok: false,
        kind: 'invalid-stem',
        message: '씬 이름은 NN-slug 형식이어야 합니다 (예: 03-night-market).',
      };
    }

    if (from.stem === to.stem) {
      return { ok: false, kind: 'invalid-stem', message: '바꿀 이름이 지금 이름과 같습니다.' };
    }

    const root = request.workspaceRoot;

    if (!(await this.deps.fileSystem.exists(scenePath(root, from.stem)))) {
      return { ok: false, kind: 'missing', message: `씬이 없습니다: ${from.stem}` };
    }

    const paths = getStoryboardProjectPaths(root);
    const rename: SceneRename = { from, to };
    const memoryScopes = await this.listMemoryScopes(paths);
    const moves = await this.planMoves(paths, memoryScopes, rename);
    const isResuming = await this.isInterruptedRename(paths, rename, moves);
    const occupant = await this.findSceneWithOrder(
      paths,
      to.order,
      isResuming ? [from.stem, to.stem] : [from.stem],
    );

    if (occupant !== undefined) {
      return {
        ok: false,
        kind: 'order-taken',
        message: `${to.order}번은 이미 ${occupant} 가 쓰고 있습니다. 그 씬을 먼저 옮겨 주세요.`,
      };
    }

    const rewrites = await this.planRewrites(paths, memoryScopes, rename);

    await this.deps.fileSystem.writeFile(
      paths.sceneRenameJournal,
      toBytes(serializeSceneRenameJournal(rename)),
    );

    for (const write of [...moves, ...rewrites]) {
      await this.deps.fileSystem.writeFile(write.to, toBytes(write.content));
    }

    for (const move of moves) {
      if (move.from !== undefined) {
        await this.deps.fileSystem.delete(move.from);
      }
    }

    await this.deleteEmptyDirectories(paths, rename);
    await this.deps.fileSystem.delete(paths.sceneRenameJournal);

    return {
      ok: true,
      kind: 'renamed',
      fromStem: from.stem,
      toStem: to.stem,
      hasOrderChanged: from.order !== to.order,
      movedFiles: moves.map((move) => relativePath(root, move.to)),
      rewrittenFiles: rewrites.map((rewrite) => relativePath(root, rewrite.to)),
    };
  }

  // NOTE: A rename cut off before it deleted the old card left the target card and possibly more
  // of the moved files. It is that rename only if its journal names this same rename and every
  // target already there holds exactly what this rename would write; otherwise the target is
  // another scene and must not be overwritten.
  private async isInterruptedRename(
    paths: StoryboardProjectPaths,
    rename: SceneRename,
    moves: readonly PlannedWrite[],
  ): Promise<boolean> {
    const journal = await this.readTextIfExists(paths.sceneRenameJournal);
    const journaled = journal === undefined ? undefined : parseSceneRenameJournal(journal);

    if (
      journaled?.from.stem !== rename.from.stem ||
      journaled.to.stem !== rename.to.stem ||
      !(await this.deps.fileSystem.exists(scenePath(paths.workspaceRoot, rename.to.stem)))
    ) {
      return false;
    }

    for (const move of moves) {
      const written = await this.readTextIfExists(move.to);

      if (written !== undefined && written !== move.content) {
        return false;
      }
    }

    return true;
  }

  private async findSceneWithOrder(
    paths: StoryboardProjectPaths,
    order: number,
    exceptStems: readonly string[],
  ): Promise<string | undefined> {
    for (const fileName of await this.listFileNames(paths.sceneDirectory)) {
      const parts = parseSceneFileName(fileName);

      if (parts !== undefined && parts.order === order && !exceptStems.includes(parts.stem)) {
        return parts.stem;
      }
    }

    return undefined;
  }

  // The main thread's memory plus one scope per non-main continuity thread.
  private async listMemoryScopes(
    paths: StoryboardProjectPaths,
  ): Promise<readonly StoryboardProjectPaths[]> {
    const threadIds = (await this.listEntries(paths.threadMemoryDirectory))
      .filter(([, entry]) => entry.type === 'directory')
      .map(([name]) => name);

    return [paths, ...threadIds.map((threadId) => resolveThreadPaths(paths, threadId))];
  }

  private async planMoves(
    paths: StoryboardProjectPaths,
    memoryScopes: readonly StoryboardProjectPaths[],
    rename: SceneRename,
  ): Promise<PlannedWrite[]> {
    const root = paths.workspaceRoot;
    const { from, to } = rename;
    const moves: PlannedWrite[] = [];

    const planMove = async (
      source: StoryUri,
      target: StoryUri,
      transform: (raw: string) => string,
    ): Promise<void> => {
      const raw = await this.readTextIfExists(source);

      if (raw !== undefined) {
        moves.push({ from: source, to: target, content: transform(raw) });
      }
    };
    const stemFile = (directory: StoryUri, stem: string, extension: string): StoryUri =>
      joinUri(directory, `${stem}${extension}`);

    await planMove(scenePath(root, from.stem), scenePath(root, to.stem), (raw) =>
      rewriteSceneCardStemText(raw, rename),
    );
    await planMove(
      joinUri(paths.sceneDirectory, sceneSummaryFileName(from.stem)),
      joinUri(paths.sceneDirectory, sceneSummaryFileName(to.stem)),
      (raw) => raw,
    );
    await planMove(draftPath(root, from.stem), draftPath(root, to.stem), (raw) =>
      serializeDraft({ ...parseDraft(raw), sceneStem: to.stem }),
    );

    const historyFrom = draftHistorySceneDirectory(root, from.stem);
    const historyTo = draftHistorySceneDirectory(root, to.stem);

    for (const fileName of await this.listFileNames(historyFrom)) {
      await planMove(joinUri(historyFrom, fileName), joinUri(historyTo, fileName), (raw) =>
        rewriteArchivedDraftStem(raw, to.stem),
      );
    }

    const rewriteJson = (raw: string): string => rewriteJsonSceneStems(raw, rename) ?? raw;

    for (const directory of [
      paths.sceneCacheDirectory,
      paths.bibleCacheDirectory,
      paths.cardCacheDirectory,
      ...memoryScopes.map((scope) => scope.sceneDialogueDirectory),
    ]) {
      await planMove(
        stemFile(directory, from.stem, '.json'),
        stemFile(directory, to.stem, '.json'),
        rewriteJson,
      );
    }

    const sessionsFrom = joinUri(paths.studioSessionDirectory, 'scene', from.stem);
    const sessionsTo = joinUri(paths.studioSessionDirectory, 'scene', to.stem);

    for (const fileName of await this.listFileNames(sessionsFrom)) {
      await planMove(joinUri(sessionsFrom, fileName), joinUri(sessionsTo, fileName), rewriteJson);
    }

    return moves;
  }

  private async planRewrites(
    paths: StoryboardProjectPaths,
    memoryScopes: readonly StoryboardProjectPaths[],
    rename: SceneRename,
  ): Promise<PlannedWrite[]> {
    const rewrites: PlannedWrite[] = [];

    const planRewrite = async (
      uri: StoryUri,
      rewrite: (raw: string) => string | undefined,
    ): Promise<void> => {
      const raw = await this.readTextIfExists(uri);
      const rewritten = raw === undefined ? undefined : rewrite(raw);

      if (rewritten !== undefined && rewritten !== raw) {
        rewrites.push({ to: uri, content: rewritten });
      }
    };
    const mentionsStem = (raw: string): boolean => raw.includes(rename.from.stem);

    for (const scope of memoryScopes) {
      await planRewrite(scope.storyState, (raw) => {
        const state = parseStoryState(raw);
        const renumbered = renumberStoryStateScene(state, rename);

        return renumbered === state ? undefined : serializeStoryState(renumbered);
      });

      for (const directory of [scope.personaMemoryDirectory, scope.backgroundMemoryDirectory]) {
        for (const fileName of await this.listFileNames(directory)) {
          await planRewrite(joinUri(directory, fileName), (raw) =>
            mentionsStem(raw) ? rewriteJsonSceneStems(raw, rename) : undefined,
          );
        }
      }
    }

    await planRewrite(paths.bibleCanon, (raw) => {
      const bible = parseBible(raw);
      const rewritten = rewriteBibleSceneReferences(bible, rename);

      return rewritten === bible ? undefined : serializeBible(rewritten);
    });

    await planRewrite(paths.outlineRevisionPlan, (raw) => {
      if (!mentionsStem(raw)) {
        return undefined;
      }

      const plan = parseRevisionPlan(raw);
      const entries = plan.entries
        .map((entry) =>
          entry.sceneStem === rename.from.stem ? { ...entry, sceneStem: rename.to.stem } : entry,
        )
        .sort((left, right) => left.sceneStem.localeCompare(right.sceneStem));

      return serializeRevisionPlan({ ...plan, entries });
    });

    for (const uri of [paths.usageLedger, joinUri(paths.cacheDirectory, 'studio-followups.json')]) {
      await planRewrite(uri, (raw) =>
        mentionsStem(raw) ? rewriteJsonSceneStems(raw, rename) : undefined,
      );
    }

    for (const fileName of await this.listFileNames(paths.characterDirectory)) {
      if (!fileName.endsWith('.card')) {
        continue;
      }

      await planRewrite(joinUri(paths.characterDirectory, fileName), (raw) => {
        if (!mentionsStem(raw)) {
          return undefined;
        }

        const card = parseCard(raw);

        if (card.type !== 'character') {
          return undefined;
        }

        const rewritten = rewriteCharacterArcSceneRefs(card, rename);

        return rewritten === card ? undefined : serializeCard(rewritten);
      });
    }

    return rewrites;
  }

  private async deleteEmptyDirectories(
    paths: StoryboardProjectPaths,
    rename: SceneRename,
  ): Promise<void> {
    for (const directory of [
      draftHistorySceneDirectory(paths.workspaceRoot, rename.from.stem),
      joinUri(paths.studioSessionDirectory, 'scene', rename.from.stem),
    ]) {
      if (
        (await this.deps.fileSystem.exists(directory)) &&
        (await this.listEntries(directory)).length === 0
      ) {
        await this.deps.fileSystem.delete(directory);
      }
    }
  }

  private async readTextIfExists(uri: StoryUri): Promise<string | undefined> {
    if (!(await this.deps.fileSystem.exists(uri))) {
      return undefined;
    }

    return new TextDecoder().decode(await this.deps.fileSystem.readFile(uri));
  }

  private async listFileNames(directory: StoryUri): Promise<readonly string[]> {
    return (await this.deps.fileSystem.exists(directory))
      ? await this.deps.fileSystem.listFileNames(directory)
      : [];
  }

  private async listEntries(directory: StoryUri): Promise<FileSystemDirectoryEntry[]> {
    return (await this.deps.fileSystem.exists(directory))
      ? await this.deps.fileSystem.readDirectory(directory)
      : [];
  }
}

// NOTE: An archive is a past draft kept for the author to read. One that no longer parses still
// belongs to the scene, so it moves with its frontmatter untouched instead of stopping the rename.
function rewriteArchivedDraftStem(raw: string, toStem: string): string {
  try {
    return serializeDraft({ ...parseDraft(raw), sceneStem: toStem });
  } catch {
    return raw;
  }
}

// Cache and memory JSON name the scene in a handful of fields: `sceneStem`, `sourceScene`,
// `sceneRef`, `updatedThroughScene`, and the `id`/`key` of a `{ kind: 'scene' }` reference.
// Returns undefined when nothing changed, so an untouched file keeps its bytes.
function rewriteJsonSceneStems(raw: string, rename: SceneRename): string | undefined {
  let changed = false;

  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(visit);
    }

    if (value === null || typeof value !== 'object') {
      return value;
    }

    const record = value as Record<string, unknown>;
    const isSceneEntity = record.kind === 'scene';

    return Object.fromEntries(
      Object.entries(record).map(([key, field]) => {
        const isStemField =
          sceneStemFieldNames.has(key) || (isSceneEntity && sceneEntityKeyFieldNames.has(key));

        if (isStemField && field === rename.from.stem) {
          changed = true;
          return [key, rename.to.stem];
        }

        return [key, visit(field)];
      }),
    );
  };

  const rewritten = visit(JSON.parse(raw));

  if (!changed) {
    return undefined;
  }

  // NOTE: Keep each file's own layout: the usage ledger is compact, every other file is indented.
  return raw.includes('\n') ? `${JSON.stringify(rewritten, null, 2)}\n` : JSON.stringify(rewritten);
}

function relativePath(root: StoryUri, uri: StoryUri): string {
  return uri.path.startsWith(`${root.path}/`) ? uri.path.slice(root.path.length + 1) : uri.path;
}

function toBytes(content: string | Uint8Array): Uint8Array {
  return typeof content === 'string' ? new TextEncoder().encode(content) : content;
}
