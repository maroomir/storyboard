import { joinStoryPath, type StoryUri } from '#model/paths/storyUri';
import type { StoryboardProjectPaths } from '#model/paths/projectPaths';
import type { SceneContextWorkspacePaths } from '#model/format/sceneContext';

export function sceneContextPaths(paths: StoryboardProjectPaths): SceneContextWorkspacePaths {
  return {
    characterDirectory: paths.characterDirectory,
    sceneDirectory: paths.sceneDirectory,
    backgroundDirectory: paths.backgroundDirectory,
    draftDirectory: paths.draftDirectory,
    bibleCanon: paths.bibleCanon,
    chapterSummaries: paths.chapterSummaries,
    storyState: paths.storyState,
    joinPath: (base: StoryUri, ...segments: string[]): StoryUri => joinStoryPath(base, ...segments),
  };
}
