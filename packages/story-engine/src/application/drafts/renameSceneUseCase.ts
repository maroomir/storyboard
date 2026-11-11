import { RevisionPlanRecorder } from '#engine/persistence/revisionPlanRecorder';
import type { HostAdapters } from '#engine/application/engineServices';
import {
  parseDraft,
  parseStoryState,
  parseSceneStem,
  renumberStoryStateScene,
  serializeDraft,
  serializeSceneRenameJournal,
  scenePath,
  serializeStoryState,
  type SceneRename,
  type StoryUri,
  draftHistorySceneDirectory,
  draftPath,
  getStoryboardProjectPaths,
  joinUri,
  resolveThreadPaths,
  type StoryboardProjectPaths,
  type SceneFileNameParts,
  type StoryState,
  type RevisionPlan,
  type RevisionPlanEntry,
} from '@storyboard/story-model';

import type { FileSystemDirectoryEntry } from '#engine/ports/fileSystem';
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
      readonly movedFiles: readonly string[];
      readonly rewrittenFiles: readonly string[];
    }
  | {
      readonly ok: false;
      readonly kind: 'invalid-stem' | 'missing' | 'order-changed';
      readonly message: string;
    }
  | UseCaseFailure;

interface PlannedWrite {
  readonly from?: StoryUri;
  readonly to: StoryUri;
  readonly content: string | Uint8Array;
}

const sceneStemFieldNames: Set<string> = new Set([
  'sceneStem',
  'sourceScene',
  'sceneRef',
  'updatedThroughScene',
]);
const sceneEntityKeyFieldNames: Set<string> = new Set(['id', 'key']);

export class RenameSceneUseCase implements IUseCase<RenameSceneRequest, RenameSceneResult> {
  public constructor(private readonly host: HostAdapters) {}

  public async execute(request: RenameSceneRequest): Promise<RenameSceneResult> {
    return await runUseCase(this.host.logger, 'RenameSceneUseCase', () => this.rename(request));
  }

  private async rename(request: RenameSceneRequest): Promise<RenameSceneResult> {
    const from: SceneFileNameParts | undefined = parseSceneStem(request.fromStem);
    const to: SceneFileNameParts | undefined = parseSceneStem(request.toStem);

    if (from === undefined || to === undefined) {
      return {
        ok: false,
        kind: 'invalid-stem',
        message: '씬 이름은 NNN-slug 형식이어야 합니다 (예: 003-night-market).',
      };
    }

    if (from.stem === to.stem) {
      return { ok: false, kind: 'invalid-stem', message: '바꿀 이름이 지금 이름과 같습니다.' };
    }

    if (from.order !== to.order) {
      return {
        ok: false,
        kind: 'order-changed',
        message: `이름 바꾸기는 번호를 그대로 둡니다. 순서를 바꾸려면 scene move 를 쓰세요 (${from.orderText}).`,
      };
    }

    const root: StoryUri = request.workspaceRoot;

    if ((await this.host.scenes.find(root, from.stem)) === undefined) {
      return { ok: false, kind: 'missing', message: `씬이 없습니다: ${from.stem}` };
    }

    return await this.renameExistingScene(root, { from, to });
  }

  private async renameExistingScene(
    root: StoryUri,
    rename: SceneRename,
  ): Promise<RenameSceneResult> {
    const { from, to } = rename;
    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(root);
    const memoryScopes: readonly StoryboardProjectPaths[] = await this.listMemoryScopes(paths);
    const moves: PlannedWrite[] = await this.planMoves(paths, memoryScopes, rename);
    const rewrites: PlannedWrite[] = await this.planRewrites(paths, memoryScopes, rename);

    await this.applyPlannedWrites(paths, rename, moves, rewrites);
    await this.renameRevisionPlanScene(root, rename);

    return {
      ok: true,
      kind: 'renamed',
      fromStem: from.stem,
      toStem: to.stem,
      movedFiles: [
        relativePath(root, scenePath(root, to.stem)),
        ...moves.map((move) => relativePath(root, move.to)),
      ],
      rewrittenFiles: rewrites.map((rewrite) => relativePath(root, rewrite.to)),
    };
  }

  private async renameRevisionPlanScene(root: StoryUri, rename: SceneRename): Promise<void> {
    const revisionPlans: RevisionPlanRecorder = new RevisionPlanRecorder(this.host);
    const plan: RevisionPlan | undefined = (await revisionPlans.readLatest(root))?.plan;
    const isMentioned: boolean =
      plan?.entries.some((entry) => entry.sceneStem === rename.from.stem) ?? false;
    if (plan === undefined || !isMentioned) {
      return;
    }

    const entries: RevisionPlanEntry[] = plan.entries
      .map((entry) =>
        entry.sceneStem === rename.from.stem ? { ...entry, sceneStem: rename.to.stem } : entry,
      )
      .sort((left, right) => left.sceneStem.localeCompare(right.sceneStem));
    await revisionPlans.replaceLatest(root, { ...plan, entries });
  }

  private async applyPlannedWrites(
    paths: StoryboardProjectPaths,
    rename: SceneRename,
    moves: readonly PlannedWrite[],
    rewrites: readonly PlannedWrite[],
  ): Promise<void> {
    await this.host.fileSystem.writeFile(
      paths.sceneRenameJournal,
      toBytes(serializeSceneRenameJournal(rename)),
    );

    for (const write of [...moves, ...rewrites]) {
      await this.host.fileSystem.writeFile(write.to, toBytes(write.content));
    }

    for (const move of moves) {
      if (move.from !== undefined) {
        await this.host.fileSystem.delete(move.from);
      }
    }

    await this.host.scenes.renameSlug(paths.workspaceRoot, rename.from.stem, rename.to.slug);
    await this.deleteEmptyDirectories(paths, rename);
    await this.host.fileSystem.delete(paths.sceneRenameJournal);
  }

  private async listMemoryScopes(
    paths: StoryboardProjectPaths,
  ): Promise<readonly StoryboardProjectPaths[]> {
    const threadIds: string[] = (await this.listEntries(paths.threadMemoryDirectory))
      .filter(([, entry]) => entry.type === 'directory')
      .map(([name]) => name);

    return [paths, ...threadIds.map((threadId) => resolveThreadPaths(paths, threadId))];
  }

  private async planMoves(
    paths: StoryboardProjectPaths,
    memoryScopes: readonly StoryboardProjectPaths[],
    rename: SceneRename,
  ): Promise<PlannedWrite[]> {
    const moves: PlannedWrite[] = [];

    await this.planDraftMove(moves, paths, rename);
    await this.planDraftHistoryMoves(moves, paths, rename);
    await this.planCacheFileMoves(moves, paths, memoryScopes, rename);
    await this.planStudioSessionMoves(moves, paths, rename);

    return moves;
  }

  private async addMove(
    moves: PlannedWrite[],
    source: StoryUri,
    target: StoryUri,
    transform: (raw: string) => string,
  ): Promise<void> {
    const raw: string | undefined = await this.readTextIfExists(source);

    if (raw !== undefined) {
      moves.push({ from: source, to: target, content: transform(raw) });
    }
  }

  private async planDraftMove(
    moves: PlannedWrite[],
    paths: StoryboardProjectPaths,
    rename: SceneRename,
  ): Promise<void> {
    const root: StoryUri = paths.workspaceRoot;

    await this.addMove(moves, draftPath(root, rename.from.stem), draftPath(root, rename.to.stem), (raw) =>
      serializeDraft({ ...parseDraft(raw), sceneStem: rename.to.stem }),
    );
  }

  private async planDraftHistoryMoves(
    moves: PlannedWrite[],
    paths: StoryboardProjectPaths,
    rename: SceneRename,
  ): Promise<void> {
    const historyFrom: StoryUri = draftHistorySceneDirectory(paths.workspaceRoot, rename.from.stem);
    const historyTo: StoryUri = draftHistorySceneDirectory(paths.workspaceRoot, rename.to.stem);

    for (const fileName of await this.listFileNames(historyFrom)) {
      await this.addMove(
        moves,
        joinUri(historyFrom, fileName),
        joinUri(historyTo, fileName),
        (raw) => rewriteArchivedDraftStem(raw, rename.to.stem),
      );
    }
  }

  private async planCacheFileMoves(
    moves: PlannedWrite[],
    paths: StoryboardProjectPaths,
    memoryScopes: readonly StoryboardProjectPaths[],
    rename: SceneRename,
  ): Promise<void> {
    for (const directory of [
      paths.sceneCacheDirectory,
      paths.cardCacheDirectory,
      ...memoryScopes.map((scope) => scope.sceneDialogueDirectory),
    ]) {
      await this.addMove(
        moves,
        stemFileUri(directory, rename.from.stem, '.json'),
        stemFileUri(directory, rename.to.stem, '.json'),
        (raw) => rewriteJsonSceneStemsOrKeep(raw, rename),
      );
    }
  }

  private async planStudioSessionMoves(
    moves: PlannedWrite[],
    paths: StoryboardProjectPaths,
    rename: SceneRename,
  ): Promise<void> {
    const sessionsFrom: StoryUri = joinUri(paths.studioSessionDirectory, 'scene', rename.from.stem);
    const sessionsTo: StoryUri = joinUri(paths.studioSessionDirectory, 'scene', rename.to.stem);

    for (const fileName of await this.listFileNames(sessionsFrom)) {
      await this.addMove(
        moves,
        joinUri(sessionsFrom, fileName),
        joinUri(sessionsTo, fileName),
        (raw) => rewriteJsonSceneStemsOrKeep(raw, rename),
      );
    }
  }

  private async planRewrites(
    paths: StoryboardProjectPaths,
    memoryScopes: readonly StoryboardProjectPaths[],
    rename: SceneRename,
  ): Promise<PlannedWrite[]> {
    const rewrites: PlannedWrite[] = [];

    for (const scope of memoryScopes) {
      await this.planMemoryScopeRewrites(rewrites, scope, rename);
    }

    await this.addRewrite(
      rewrites,
      joinUri(paths.cacheDirectory, 'studio-followups.json'),
      (raw) => rewriteMentionedJsonSceneStems(raw, rename),
    );


    return rewrites;
  }

  private async addRewrite(
    rewrites: PlannedWrite[],
    uri: StoryUri,
    rewrite: (raw: string) => string | undefined,
  ): Promise<void> {
    const raw: string | undefined = await this.readTextIfExists(uri);
    const rewritten: string | undefined = raw === undefined ? undefined : rewrite(raw);

    if (rewritten !== undefined && rewritten !== raw) {
      rewrites.push({ to: uri, content: rewritten });
    }
  }

  private async planMemoryScopeRewrites(
    rewrites: PlannedWrite[],
    scope: StoryboardProjectPaths,
    rename: SceneRename,
  ): Promise<void> {
    await this.addRewrite(rewrites, scope.storyState, (raw) => rewriteStoryStateText(raw, rename));

    for (const directory of [scope.personaMemoryDirectory, scope.backgroundMemoryDirectory]) {
      for (const fileName of await this.listFileNames(directory)) {
        await this.addRewrite(rewrites, joinUri(directory, fileName), (raw) =>
          rewriteMentionedJsonSceneStems(raw, rename),
        );
      }
    }
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
        (await this.host.fileSystem.exists(directory)) &&
        (await this.listEntries(directory)).length === 0
      ) {
        await this.host.fileSystem.delete(directory);
      }
    }
  }

  private async readTextIfExists(uri: StoryUri): Promise<string | undefined> {
    if (!(await this.host.fileSystem.exists(uri))) {
      return undefined;
    }

    return new TextDecoder().decode(await this.host.fileSystem.readFile(uri));
  }

  private async listFileNames(directory: StoryUri): Promise<readonly string[]> {
    return (await this.host.fileSystem.exists(directory))
      ? await this.host.fileSystem.listFileNames(directory)
      : [];
  }

  private async listEntries(directory: StoryUri): Promise<FileSystemDirectoryEntry[]> {
    return (await this.host.fileSystem.exists(directory))
      ? await this.host.fileSystem.readDirectory(directory)
      : [];
  }
}

function rewriteArchivedDraftStem(raw: string, toStem: string): string {
  try {
    return serializeDraft({ ...parseDraft(raw), sceneStem: toStem });
  } catch {
    return raw;
  }
}

function stemFileUri(directory: StoryUri, stem: string, extension: string): StoryUri {
  return joinUri(directory, `${stem}${extension}`);
}

function mentionsFromStem(raw: string, rename: SceneRename): boolean {
  return raw.includes(rename.from.stem);
}

function rewriteJsonSceneStemsOrKeep(raw: string, rename: SceneRename): string {
  return rewriteJsonSceneStems(raw, rename) ?? raw;
}

function rewriteMentionedJsonSceneStems(raw: string, rename: SceneRename): string | undefined {
  return mentionsFromStem(raw, rename) ? rewriteJsonSceneStems(raw, rename) : undefined;
}

function rewriteStoryStateText(raw: string, rename: SceneRename): string | undefined {
  const state: StoryState = parseStoryState(raw);
  const renumbered: StoryState = renumberStoryStateScene(state, rename);

  return renumbered === state ? undefined : serializeStoryState(renumbered);
}

function rewriteJsonSceneStems(raw: string, rename: SceneRename): string | undefined {
  let changed: boolean = false;

  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(visit);
    }

    if (value === null || typeof value !== 'object') {
      return value;
    }

    const record: Record<string, unknown> = value as Record<string, unknown>;
    const isSceneEntity: boolean = record.kind === 'scene';

    return Object.fromEntries(
      Object.entries(record).map(([key, field]) => {
        const isStemField: boolean =
          sceneStemFieldNames.has(key) || (isSceneEntity && sceneEntityKeyFieldNames.has(key));

        if (isStemField && field === rename.from.stem) {
          changed = true;
          return [key, rename.to.stem];
        }

        return [key, visit(field)];
      }),
    );
  };

  const rewritten: unknown = visit(JSON.parse(raw));

  if (!changed) {
    return undefined;
  }

  return raw.includes('\n') ? `${JSON.stringify(rewritten, null, 2)}\n` : JSON.stringify(rewritten);
}

function relativePath(root: StoryUri, uri: StoryUri): string {
  return uri.path.startsWith(`${root.path}/`) ? uri.path.slice(root.path.length + 1) : uri.path;
}

function toBytes(content: string | Uint8Array): Uint8Array {
  return typeof content === 'string' ? new TextEncoder().encode(content) : content;
}
