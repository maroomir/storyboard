import {
  draftPath,
  getStoryboardProjectPaths,
  isOutlineStale,
  joinStoryPath,
  type SceneListItem,
  type StoryboardProject,
  type StoryboardProjectPaths,
  type StoryUri,
  mainThreadId,
  bundleFileNames,
} from '@storyboard/story-model';
import type { ConfigBridge } from '@storyboard/story-ai';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type { ISceneSidebarRepository } from '#engine/application/cards/sceneSidebarRepository';
import type { ISceneCacheRepository } from '#engine/application/drafts/draftRepositories';
import type { ChapterSummaryLedger } from '#engine/persistence/cache/chapterSummaryLedger';
import type { WorkspaceCards } from '#engine/persistence/bundles/workspaceCards';
import type {
  SceneRoster,
  SceneRosterEntry,
  WorkspaceScenes,
} from '#engine/persistence/bundles/workspaceScenes';
import { DraftInputRecord } from '#engine/persistence/draftInputRecord';
import {
  memoizeFileReads,
  SceneInputHasher,
  type SceneInputHashSettings,
} from '#engine/persistence/sceneInputHasher';
import { ProjectRepository } from '#engine/persistence/repositories/projectRepository';
import { sceneCacheFilePath } from '#engine/persistence/sceneCacheWorkspace';
import { resolveSceneBreakJoiner } from '#engine/pipeline/sceneGenerationPolicies';

export interface SceneSidebarRepositoryDependencies {
  readonly fileSystem: IFileSystem;
  readonly scenes: WorkspaceScenes;
  readonly cards: WorkspaceCards;
  readonly summaries: ChapterSummaryLedger;
  readonly sceneCache: ISceneCacheRepository;
  readonly configBridge: Pick<ConfigBridge, 'getDraftSceneBreakSeparator'>;
}

interface DraftFreshnessCheck {
  readonly paths: StoryboardProjectPaths;
  readonly records: DraftInputRecord;
  readonly hasher: SceneInputHasher;
  readonly settings: SceneInputHashSettings | undefined;
}

interface DraftAndCardTimes {
  readonly draftModifiedAt: number;
  readonly sceneMtime: number;
}

const sceneCardFiles: readonly string[] = [
  bundleFileNames.card,
  bundleFileNames.statements,
  bundleFileNames.beats,
];

function judgeUnrecordedDraftByModifiedTime(times: DraftAndCardTimes): SceneListItem['status'] {
  return times.draftModifiedAt >= times.sceneMtime ? 'ready' : 'stale';
}

export class SceneSidebarRepository implements ISceneSidebarRepository {
  public constructor(private readonly dependencies: SceneSidebarRepositoryDependencies) {}

  public async list(workspaceRoot: StoryUri): Promise<SceneListItem[]> {
    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceRoot);
    const roster: SceneRoster = await this.dependencies.scenes.loadRoster(workspaceRoot);
    const outlineMtime: number | undefined = await this.tryStatMtime(paths.outlineChapters);
    const freshness: DraftFreshnessCheck = await this.createFreshnessCheck(paths);

    return await Promise.all(
      roster.entries.map(
        async (entry) => await this.toItem(workspaceRoot, entry, outlineMtime, freshness),
      ),
    );
  }

  private async toItem(
    root: StoryUri,
    entry: SceneRosterEntry,
    outlineMtime: number | undefined,
    freshness: DraftFreshnessCheck,
  ): Promise<SceneListItem> {
    const { file } = entry;
    const sceneUri: StoryUri = joinStoryPath(root, ...entry.path.split('/'));
    const draftUri: StoryUri = draftPath(root, file.stem);
    const sceneMtime: number = await this.latestCardTime(sceneUri);
    const draftModifiedAt: number = await this.dependencies.fileSystem.modifiedTime(draftUri);
    const hasDraft: boolean = draftModifiedAt > 0;
    const status: SceneListItem['status'] = hasDraft
      ? await this.judgeDraftStatus(entry, freshness, { draftModifiedAt, sceneMtime })
      : 'missing';
    const title: string | undefined = file.frontmatter.title?.trim() || undefined;

    return {
      stem: file.stem,
      order: file.order,
      slug: file.slug,
      id: entry.content.header.id,
      thread: entry.entry?.thread ?? mainThreadId,
      title,
      sceneUri: sceneUri.toString(),
      draftUri: hasDraft ? draftUri.toString() : undefined,
      status,
      sceneMtime,
      draftMtime: hasDraft ? draftModifiedAt : undefined,
      outlineStale: isOutlineStale(outlineMtime, sceneMtime),
    };
  }

  private async judgeDraftStatus(
    entry: SceneRosterEntry,
    freshness: DraftFreshnessCheck,
    times: DraftAndCardTimes,
  ): Promise<SceneListItem['status']> {
    const { paths, records, hasher, settings } = freshness;
    const recordedHash: string | undefined = await records.readRecordedHash({
      workspaceRoot: paths.workspaceRoot,
      stem: entry.file.stem,
      cacheUri: sceneCacheFilePath(paths, entry.file),
    });
    if (recordedHash === undefined || settings === undefined) {
      return judgeUnrecordedDraftByModifiedTime(times);
    }

    const currentHash: string | undefined = await hasher.computeCurrent(
      paths,
      entry.file.stem,
      settings,
    );
    return currentHash === recordedHash ? 'ready' : 'stale';
  }

  private async createFreshnessCheck(paths: StoryboardProjectPaths): Promise<DraftFreshnessCheck> {
    const { fileSystem, scenes, cards, summaries, sceneCache } = this.dependencies;
    const reads: IFileSystem = memoizeFileReads(fileSystem);

    return {
      paths,
      records: new DraftInputRecord({ fileSystem, scenes, sceneCache }),
      hasher: new SceneInputHasher({ fileSystem: reads, cards, scenes, summaries }),
      settings: await this.readHashSettings(paths),
    };
  }

  private async readHashSettings(
    paths: StoryboardProjectPaths,
  ): Promise<SceneInputHashSettings | undefined> {
    let project: StoryboardProject;
    try {
      project = await new ProjectRepository(this.dependencies.fileSystem).read(paths.projectJson);
    } catch {
      return undefined;
    }

    return {
      format: project.format,
      sceneBreakJoiner: resolveSceneBreakJoiner(
        this.dependencies.configBridge.getDraftSceneBreakSeparator(),
      ),
    };
  }

  private async latestCardTime(sceneUri: StoryUri): Promise<number> {
    const times: number[] = await Promise.all(
      sceneCardFiles.map((fileName) =>
        this.dependencies.fileSystem.modifiedTime(joinStoryPath(sceneUri, fileName)),
      ),
    );
    return Math.max(0, ...times);
  }

  private async tryStatMtime(uri: StoryUri): Promise<number | undefined> {
    try {
      return await this.dependencies.fileSystem.modifiedTime(uri);
    } catch {
      return undefined;
    }
  }
}
