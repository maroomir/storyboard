import { summaryFileName } from '../domain/chapterSummaries';
import { joinStoryPath, type StoryUri } from './storyUri';
import type { StoryboardProjectPaths } from './projectPaths';
import type { SceneContextWorkspacePaths } from '@storyboard/story-format';

export function sceneContextPaths(paths: StoryboardProjectPaths): SceneContextWorkspacePaths {
  return {
    characterDirectory: paths.characterDirectory,
    backgroundDirectory: paths.backgroundDirectory,
    draftDirectory: paths.draftDirectory,
    bibleCanon: paths.bibleCanon,
    manuscriptSummary: joinStoryPath(paths.manuscriptDirectory, summaryFileName),
    storyState: paths.storyState,
    joinPath: (base: unknown, ...segments: string[]): StoryUri =>
      joinStoryPath(base as StoryUri, ...segments),
  };
}
