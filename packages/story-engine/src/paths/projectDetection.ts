import { getStoryboardProjectPaths } from './projectPaths';
import type { StoryUri, StoryWorkspaceFolder } from './storyUri';

export type UriExists = (uri: StoryUri) => Promise<boolean>;

export async function hasStoryboardProjectAt(
  workspaceRoot: StoryUri,
  exists: UriExists,
): Promise<boolean> {
  return exists(getStoryboardProjectPaths(workspaceRoot).projectJson);
}

export async function anyStoryboardProjectInWorkspaceFolders(
  folders: readonly StoryWorkspaceFolder[] | undefined,
  exists: UriExists,
): Promise<boolean> {
  if (!folders?.length) {
    return false;
  }

  for (const folder of folders) {
    if (await hasStoryboardProjectAt(folder.uri, exists)) {
      return true;
    }
  }

  return false;
}
