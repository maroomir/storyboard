import { joinStoryPath, type StoryUri } from '../../paths/storyUri';
import type { IFileSystem } from '../../ports/fileSystem';
import type { ISceneSidebarRepository } from '../../application/cards/sceneSidebarRepository';
import {
  draftPath,
  getStoryboardProjectPaths,
  isHiddenSceneFileName,
} from '../../paths/projectPaths';
import { isOutlineStale } from '../../domain/sceneStatus';
import { parseSceneFileName, readSceneFile } from '@storyboard/story-format';
import type { SceneFileSystem } from '@storyboard/story-format';
import type { SceneListItem } from '../../shared/messaging/scenes';
export class SceneSidebarRepository implements ISceneSidebarRepository {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async list(workspaceRoot: StoryUri): Promise<SceneListItem[]> {
    const paths = getStoryboardProjectPaths(workspaceRoot);
    const entries = await this.fileSystem.readDirectory(paths.sceneDirectory);
    const names = entries
      .filter(([, entry]) => entry.type === 'file')
      .map(([name]) => name)
      .filter((name) => !isHiddenSceneFileName(name))
      .filter((name) => parseSceneFileName(name) !== undefined);
    const outlineMtime = await this.tryStatMtime(paths.outlineChapters);
    const items = await Promise.all(
      names.map(async (name) => await this.toItem(workspaceRoot, name, outlineMtime)),
    );
    return items.sort((left, right) => left.order - right.order);
  }

  private async toItem(
    root: StoryUri,
    name: string,
    outlineMtime: number | undefined,
  ): Promise<SceneListItem> {
    const parts = parseSceneFileName(name);
    if (!parts) throw new Error(`Invariant: invalid scene file name ${name}`);
    const paths = getStoryboardProjectPaths(root);
    const sceneUri = joinStoryPath(paths.sceneDirectory, name);
    const draftUri = draftPath(root, parts.stem);
    const sceneMtime = await this.fileSystem.modifiedTime(sceneUri);
    let draftMtime: number | undefined;
    let draftUriString: string | undefined;
    let status: SceneListItem['status'];
    try {
      draftMtime = await this.fileSystem.modifiedTime(draftUri);
      draftUriString = draftUri.toString();
      status = draftMtime >= sceneMtime ? 'ready' : 'stale';
    } catch {
      status = 'missing';
    }
    let title: string | undefined;
    try {
      const scene = await readSceneFile(sceneUri, this.fileSystem, name);
      const raw = scene.frontmatter.title?.trim();
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
