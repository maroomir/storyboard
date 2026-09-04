import { joinStoryPath, type StoryUri } from './storyUri';
import type { StoryboardProjectPaths } from './projectPaths';
import type { SceneContextWorkspacePaths } from '@storyboard/story-format';

export function sceneContextPaths(paths: StoryboardProjectPaths): SceneContextWorkspacePaths {
  return {
    characterDirectory: paths.characterDirectory,
    backgroundDirectory: paths.backgroundDirectory,
    draftDirectory: paths.draftDirectory,
    bibleCanon: paths.bibleCanon,
    chapterSummaries: paths.chapterSummaries,
    storyState: paths.storyState,
    joinPath: (base: StoryUri, ...segments: string[]): StoryUri => joinStoryPath(base, ...segments),
  };
}
