import { RevisionPlanRecorder } from '#engine/persistence/revisionPlanRecorder';
import type { HostAdapters } from '#engine/application/engineServices';
import {
  parseDraft,
  parseSceneStem,
  serializeDraft,
  serializeSceneRenameJournal,
  scenePath,
  type SceneRename,
  type StoryUri,
  draftPath,
  getStoryboardProjectPaths,
  joinUri,
  type StoryboardProjectPaths,
  type SceneFileNameParts,
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
    const moves: PlannedWrite[] = await this.planMoves(paths, rename);
    const rewrites: PlannedWrite[] = await this.planRewrites(paths, rename);

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

  private async planMoves(
    paths: StoryboardProjectPaths,
    rename: SceneRename,
  ): Promise<PlannedWrite[]> {
    const moves: PlannedWrite[] = [];

    await this.planDraftMove(moves, paths, rename);
    await this.planCacheFileMoves(moves, paths, rename);
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

  private async planCacheFileMoves(
    moves: PlannedWrite[],
    paths: StoryboardProjectPaths,
    rename: SceneRename,
  ): Promise<void> {
    for (const directory of [
      paths.sceneCacheDirectory,
      paths.cardCacheDirectory,
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
    rename: SceneRename,
  ): Promise<PlannedWrite[]> {
    const rewrites: PlannedWrite[] = [];

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

  private async deleteEmptyDirectories(
    paths: StoryboardProjectPaths,
    rename: SceneRename,
  ): Promise<void> {
    for (const directory of [
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
