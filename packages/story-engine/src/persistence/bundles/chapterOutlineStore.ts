import { posix } from 'node:path';

import {
  getStoryboardProjectPaths,
  isChapterOutlineUnseeded,
  outlineOfChapterPlan,
  parseChapterOutline,
  parseChapterPlan,
  projectChapterPlan,
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
import type {
  SceneRoster,
  SceneRosterEntry,
  WorkspaceScenes,
} from '#engine/persistence/bundles/workspaceScenes';

export interface ChapterOutlineStoreDependencies {
  readonly fileSystem: IFileSystem;
  readonly scenes: WorkspaceScenes;
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
    await this.dependencies.fileSystem.createDirectory(
      paths.pendingChapterPlan.with({ path: posix.dirname(paths.pendingChapterPlan.path) }),
    );
    await this.writeText(paths.pendingChapterPlan, serializeChapterPlan(plan));
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
    if (await this.dependencies.fileSystem.exists(paths.pendingChapterPlan)) {
      await this.dependencies.fileSystem.delete(paths.pendingChapterPlan);
    }
  }

  private async loadPending(workspaceRoot: StoryUri): Promise<ChapterPlan | undefined> {
    const uri: StoryUri = getStoryboardProjectPaths(workspaceRoot).pendingChapterPlan;
    return (await this.dependencies.fileSystem.exists(uri))
      ? parseChapterPlan(await this.readText(uri))
      : undefined;
  }

  private async readText(uri: StoryUri): Promise<string> {
    return new TextDecoder().decode(await this.dependencies.fileSystem.readFile(uri));
  }

  private async writeText(uri: StoryUri, text: string): Promise<void> {
    await this.dependencies.fileSystem.writeFile(uri, new TextEncoder().encode(text));
  }
}
