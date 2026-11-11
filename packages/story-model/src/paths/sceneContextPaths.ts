import { joinStoryPath, type StoryUri } from '#model/paths/storyUri';
import type { StoryboardProjectPaths } from '#model/paths/projectPaths';
import type { SceneContextWorkspacePaths } from '#model/format/sceneContext';

export function sceneContextPaths(paths: StoryboardProjectPaths): SceneContextWorkspacePaths {
  return {
    workspaceRoot: paths.workspaceRoot,
    characterDirectory: paths.characterDirectory,
    sceneDirectory: paths.sceneDirectory,
    backgroundDirectory: paths.backgroundDirectory,
    draftDirectory: paths.draftDirectory,
    threadId: paths.threadId,
    joinPath: (base: StoryUri, ...segments: string[]): StoryUri => joinStoryPath(base, ...segments),
  };
}
