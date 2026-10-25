import {
  joinStoryPath,
  type StoryUri,
  parseSceneFileName,
  readSceneFile,
  draftPath,
  getStoryboardProjectPaths,
  isHiddenSceneFileName,
  isOutlineStale,
} from '@storyboard/story-model';
import type { FileSystemDirectoryEntry, IFileSystem } from '#engine/ports/fileSystem';
import type { ISceneSidebarRepository } from '#engine/application/cards/sceneSidebarRepository';
import type {
  SceneFile,
  SceneFileNameParts,
  SceneListItem,
  StoryboardProjectPaths,
} from '@storyboard/story-model';
export class SceneSidebarRepository implements ISceneSidebarRepository {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async list(workspaceRoot: StoryUri): Promise<SceneListItem[]> {
    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceRoot);
    const entries: FileSystemDirectoryEntry[] = await this.fileSystem.readDirectory(
      paths.sceneDirectory,
    );
    const names: string[] = entries
      .filter(([, entry]) => entry.type === 'file')
      .map(([name]) => name)
      .filter((name) => !isHiddenSceneFileName(name))
      .filter((name) => parseSceneFileName(name) !== undefined);
    const outlineMtime: number | undefined = await this.tryStatMtime(paths.outlineChapters);
    const items: SceneListItem[] = await Promise.all(
      names.map(async (name) => await this.toItem(workspaceRoot, name, outlineMtime)),
    );
    return items.sort((left, right) => left.order - right.order);
  }

  private async toItem(
    root: StoryUri,
    name: string,
    outlineMtime: number | undefined,
  ): Promise<SceneListItem> {
    const parts: SceneFileNameParts | undefined = parseSceneFileName(name);
    if (!parts) throw new Error(`Invariant: invalid scene file name ${name}`);
    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(root);
    const sceneUri: StoryUri = joinStoryPath(paths.sceneDirectory, name);
    const draftUri: StoryUri = draftPath(root, parts.stem);
    const sceneMtime: number = await this.fileSystem.modifiedTime(sceneUri);
    // A missing draft reports 0, which is what tells these apart — not an exception, which only
    // the VSCode adapter used to raise.
    const draftModifiedAt: number = await this.fileSystem.modifiedTime(draftUri);
    const hasDraft: boolean = draftModifiedAt > 0;
    const draftMtime: number | undefined = hasDraft ? draftModifiedAt : undefined;
    const draftUriString: string | undefined = hasDraft ? draftUri.toString() : undefined;
    const status: SceneListItem['status'] = !hasDraft
      ? 'missing'
      : draftModifiedAt >= sceneMtime
        ? 'ready'
        : 'stale';
    let title: string | undefined;
    try {
      const scene: SceneFile = await readSceneFile(sceneUri, this.fileSystem, name);
      const raw: string | undefined = scene.frontmatter.title?.trim();
      title = raw || undefined;
    } catch {
      // NOTE: A malformed scene stays visible without a frontmatter title.
    }
    return {
      stem: parts.stem,
      order: parts.order,
      slug: parts.slug,
      title,
      sceneUri: sceneUri.toString(),
      draftUri: draftUriString,
      status,
      sceneMtime,
      draftMtime,
      outlineStale: isOutlineStale(outlineMtime, sceneMtime),
    };
  }

  private async tryStatMtime(uri: StoryUri): Promise<number | undefined> {
    try {
      return await this.fileSystem.modifiedTime(uri);
    } catch {
      return undefined;
    }
  }
}
