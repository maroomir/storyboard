import {
  bundleFileNames,
  draftPath,
  getStoryboardProjectPaths,
  isOutlineStale,
  joinStoryPath,
  type SceneListItem,
  type StoryboardProjectPaths,
  type StoryUri,
} from '@storyboard/story-model';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type { ISceneSidebarRepository } from '#engine/application/cards/sceneSidebarRepository';
import type {
  SceneRoster,
  SceneRosterEntry,
  WorkspaceScenes,
} from '#engine/persistence/bundles/workspaceScenes';

const sceneCardFiles: readonly string[] = [
  bundleFileNames.card,
  bundleFileNames.statements,
  bundleFileNames.beats,
];

export class SceneSidebarRepository implements ISceneSidebarRepository {
  public constructor(
    private readonly fileSystem: IFileSystem,
    private readonly scenes: WorkspaceScenes,
  ) {}

  public async list(workspaceRoot: StoryUri): Promise<SceneListItem[]> {
    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceRoot);
    const roster: SceneRoster = await this.scenes.loadRoster(workspaceRoot);
    const outlineMtime: number | undefined = await this.tryStatMtime(paths.outlineChapters);

    return await Promise.all(
      roster.entries.map(async (entry) => await this.toItem(workspaceRoot, entry, outlineMtime)),
    );
  }

  private async toItem(
    root: StoryUri,
    entry: SceneRosterEntry,
    outlineMtime: number | undefined,
  ): Promise<SceneListItem> {
    const { file } = entry;
    const sceneUri: StoryUri = joinStoryPath(root, ...entry.path.split('/'));
    const draftUri: StoryUri = draftPath(root, file.stem);
    const sceneMtime: number = await this.latestCardTime(sceneUri);
    const draftModifiedAt: number = await this.fileSystem.modifiedTime(draftUri);
    const hasDraft: boolean = draftModifiedAt > 0;
    const status: SceneListItem['status'] = !hasDraft
      ? 'missing'
      : draftModifiedAt >= sceneMtime
        ? 'ready'
        : 'stale';
    const title: string | undefined = file.frontmatter.title?.trim() || undefined;

    return {
      stem: file.stem,
      order: file.order,
      slug: file.slug,
      title,
      sceneUri: sceneUri.toString(),
      draftUri: hasDraft ? draftUri.toString() : undefined,
      status,
      sceneMtime,
      draftMtime: hasDraft ? draftModifiedAt : undefined,
      outlineStale: isOutlineStale(outlineMtime, sceneMtime),
    };
  }

  private async latestCardTime(sceneUri: StoryUri): Promise<number> {
    const times: number[] = await Promise.all(
      sceneCardFiles.map((fileName) => this.fileSystem.modifiedTime(joinStoryPath(sceneUri, fileName))),
    );
    return Math.max(0, ...times);
  }

  private async tryStatMtime(uri: StoryUri): Promise<number | undefined> {
    try {
      return await this.fileSystem.modifiedTime(uri);
    } catch {
      return undefined;
    }
  }
}
