import {
  readCardFile,
  readSceneFile,
  scenePath,
  type SceneFile,
  type StoryboardCard,
  type StoryUri,
} from '@storyboard/story-model';
import type { IFileSystem } from '#engine/ports/fileSystem';

export async function readCardOrUndefined(
  fs: IFileSystem,
  uri: StoryUri,
): Promise<StoryboardCard | undefined> {
  try {
    return await readCardFile(uri, fs);
  } catch {
    return undefined;
  }
}

export async function readSceneOrUndefined(
  fs: IFileSystem,
  workspaceRoot: StoryUri,
  sceneStem: string,
): Promise<SceneFile | undefined> {
  try {
    return await readSceneFile(scenePath(workspaceRoot, sceneStem), fs, `${sceneStem}.card`);
  } catch {
    return undefined;
  }
}
