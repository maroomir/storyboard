import {
  getStoryboardProjectPaths,
  isChapterOutlineUnseeded,
  outlineOfChapterPlan,
  parseChapterOutline,
  parseChapterPlan,
  placeSceneAfterInOutline,
  projectChapterPlan,
  removeSceneFromOutline,
  scenePlanOfScene,
  serializeChapterOutline,
  serializeChapterPlan,
  type ChapterOutline,
  type ChapterPlan,
  type GeneratedSceneSeed,
  type ScenePlan,
  type StoryboardProjectPaths,
  type StoryUri,
} from '@storyboard/story-model';

import type { IFileSystem } from '#engine/ports/fileSystem';
import { SessionStore, type SessionRecord } from '#engine/persistence/cache/sessionStore';
import type { WorkspaceCaches } from '#engine/persistence/cache/workspaceCaches';
import type {
  SceneRoster,
  SceneRosterEntry,
  WorkspaceScenes,
} from '#engine/persistence/bundles/workspaceScenes';

export interface ChapterOutlineStoreDependencies {
  readonly fileSystem: IFileSystem;
  readonly scenes: WorkspaceScenes;
  readonly caches: WorkspaceCaches;
}

interface PendingChapterPlanData {
  readonly title: string;
  readonly pendingChapterPlan: string;
}

const pendingChapterPlanSessionTitle: string = 'outline generate';

function isPendingChapterPlanSession(record: SessionRecord): boolean {
  const data: unknown = record.data;
  const hasPlan: boolean =
    typeof data === 'object' &&
    data !== null &&
    typeof (data as Partial<PendingChapterPlanData>).pendingChapterPlan === 'string';
  return record.elementId === undefined && record.closedAt === undefined && hasPlan;
}

export class ChapterOutlineStore {
  public constructor(private readonly dependencies: ChapterOutlineStoreDependencies) {}

  public async load(workspaceRoot: StoryUri): Promise<ChapterPlan> {
    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceRoot);
    const outline: ChapterOutline = parseChapterOutline(
      await this.readText(paths.outlineChapters),
    );
    const pending: ChapterPlan | undefined = isChapterOutlineUnseeded(outline)
      ? await this.loadPending(workspaceRoot)
      : undefined;
    if (pending !== undefined) {
      return pending;
    }

    const roster: SceneRoster = await this.dependencies.scenes.loadRoster(workspaceRoot);
    const planById: ReadonlyMap<string, ScenePlan> = new Map(
      roster.entries.map((entry: SceneRosterEntry) => [
        entry.content.header.id,
        scenePlanOfScene(entry.file),
      ]),
    );

    return projectChapterPlan(outline, (sceneId) => planById.get(sceneId));
  }

  public async save(workspaceRoot: StoryUri, plan: ChapterPlan): Promise<void> {
    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceRoot);
    await this.savePending(workspaceRoot, plan);
    await this.dependencies.fileSystem.createDirectory(paths.outlineDirectory);
    await this.writeText(
      paths.outlineChapters,
      serializeChapterOutline(outlineOfChapterPlan(plan, () => undefined)),
    );
  }

  public async recordSeeded(
    workspaceRoot: StoryUri,
    plan: ChapterPlan,
    seeds: readonly GeneratedSceneSeed[],
  ): Promise<void> {
    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceRoot);
    const sceneIds: (string | undefined)[] = [];
    for (const seed of seeds) {
      sceneIds.push((await this.dependencies.scenes.find(workspaceRoot, seed.stem))?.content.header.id);
    }

    await this.writeText(
      paths.outlineChapters,
      serializeChapterOutline(outlineOfChapterPlan(plan, (flatIndex) => sceneIds[flatIndex])),
    );
    await this.closePending(workspaceRoot);
  }

  public async removeScene(workspaceRoot: StoryUri, sceneId: string): Promise<void> {
    await this.rewriteOutline(workspaceRoot, (outline) => removeSceneFromOutline(outline, sceneId));
  }

  public async placeSceneAfter(
    workspaceRoot: StoryUri,
    sceneId: string,
    afterSceneId: string | undefined,
  ): Promise<void> {
    await this.rewriteOutline(workspaceRoot, (outline) =>
      placeSceneAfterInOutline(outline, sceneId, afterSceneId),
    );
  }

  private async rewriteOutline(
    workspaceRoot: StoryUri,
    transform: (outline: ChapterOutline) => ChapterOutline,
  ): Promise<void> {
    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceRoot);
    if (!(await this.dependencies.fileSystem.exists(paths.outlineChapters))) {
      return;
    }

    const outline: ChapterOutline = parseChapterOutline(await this.readText(paths.outlineChapters));
    const rewritten: ChapterOutline = transform(outline);
    if (rewritten !== outline) {
      await this.writeText(paths.outlineChapters, serializeChapterOutline(rewritten));
    }
  }

  private async loadPending(workspaceRoot: StoryUri): Promise<ChapterPlan | undefined> {
    const record: SessionRecord | undefined = (await this.sessions(workspaceRoot))
      .listByKind('studio')
      .filter(isPendingChapterPlanSession)
      .at(-1);
    return record === undefined
      ? undefined
      : parseChapterPlan((record.data as PendingChapterPlanData).pendingChapterPlan);
  }

  private async savePending(workspaceRoot: StoryUri, plan: ChapterPlan): Promise<void> {
    await this.closePending(workspaceRoot);
    const data: PendingChapterPlanData = {
      title: pendingChapterPlanSessionTitle,
      pendingChapterPlan: serializeChapterPlan(plan),
    };
    (await this.sessions(workspaceRoot)).open({ kind: 'studio', data, pendingCount: 1 });
  }

  private async closePending(workspaceRoot: StoryUri): Promise<void> {
    const store: SessionStore = await this.sessions(workspaceRoot);
    for (const record of store.listByKind('studio').filter(isPendingChapterPlanSession)) {
      store.update(record.id, { data: { title: pendingChapterPlanSessionTitle }, pendingCount: 0 });
      store.close(record.id);
    }
  }

  private async sessions(workspaceRoot: StoryUri): Promise<SessionStore> {
    return new SessionStore(await this.dependencies.caches.open(workspaceRoot));
  }

  private async readText(uri: StoryUri): Promise<string> {
    return new TextDecoder().decode(await this.dependencies.fileSystem.readFile(uri));
  }

  private async writeText(uri: StoryUri, text: string): Promise<void> {
    await this.dependencies.fileSystem.writeFile(uri, new TextEncoder().encode(text));
  }
}
