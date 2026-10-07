import {
  getStoryboardProjectPaths,
  parseSceneGroundingGaps,
  serializeSceneGroundingGaps,
  type SceneGroundingGap,
  type StoryUri,
} from '@storyboard/story-model';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type { ISceneGroundingGapRepository } from '#engine/application/drafts/draftRepositories';

export class SceneGroundingGapRepository implements ISceneGroundingGapRepository {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async read(
    workspaceRoot: StoryUri,
    sceneStem: string,
  ): Promise<SceneGroundingGap | undefined> {
    return (await this.readAll(workspaceRoot))[sceneStem];
  }

  public async write(
    workspaceRoot: StoryUri,
    sceneStem: string,
    gap: SceneGroundingGap | undefined,
  ): Promise<void> {
    const { [sceneStem]: previous, ...others } = await this.readAll(workspaceRoot);

    if (gap === undefined && previous === undefined) {
      return;
    }

    const paths = getStoryboardProjectPaths(workspaceRoot);
    const next = gap === undefined ? others : { ...others, [sceneStem]: gap };
    await this.fileSystem.createDirectory(paths.cacheDirectory);
    await this.fileSystem.writeFile(
      paths.sceneGroundingGaps,
      new TextEncoder().encode(serializeSceneGroundingGaps(next)),
    );
  }

  private async readAll(workspaceRoot: StoryUri): Promise<Record<string, SceneGroundingGap>> {
    const gapsUri = getStoryboardProjectPaths(workspaceRoot).sceneGroundingGaps;

    if (!(await this.fileSystem.exists(gapsUri))) {
      return {};
    }

    // A record that cannot be read is no record: the cache saves a call, it never blocks one.
    try {
      const raw = new TextDecoder().decode(await this.fileSystem.readFile(gapsUri));
      return { ...parseSceneGroundingGaps(raw) };
    } catch {
      return {};
    }
  }
}
