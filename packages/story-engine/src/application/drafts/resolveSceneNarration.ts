import {
  flattenChapterPlan,
  readChapterPlanFile,
  resolveNarration,
  type NarrationDirective,
  type SceneFile,
  type StoryboardProject,
} from '@storyboard/story-model';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type {
  ChapterPlan,
  FlatChapterScene,
  ProjectSetting,
  StoryboardProjectPaths,
} from '@storyboard/story-model';
import { loadNarratorCards } from '#engine/persistence/narratorCards';

export interface ChapterNarrationDefaults {
  readonly narrator?: string;
  readonly thread?: string;
}

export async function readChapterNarrationDefaults(
  paths: StoryboardProjectPaths,
  sceneOrder: number,
  fileSystem: IFileSystem,
): Promise<ChapterNarrationDefaults> {
  try {
    const plan: ChapterPlan = await readChapterPlanFile(paths.outlineChapters, fileSystem);
    const placement: FlatChapterScene | undefined = flattenChapterPlan(plan)[sceneOrder - 1];

    return {
      ...(placement?.chapterNarrator === undefined ? {} : { narrator: placement.chapterNarrator }),
      ...(placement?.chapterThread === undefined ? {} : { thread: placement.chapterThread }),
    };
  } catch {
    return {};
  }
}

export async function resolveSceneNarration(
  paths: StoryboardProjectPaths,
  scene: SceneFile,
  project: StoryboardProject,
  chapterDefaults: ChapterNarrationDefaults,
  fileSystem: IFileSystem,
): Promise<NarrationDirective | undefined> {
  const setting: ProjectSetting | undefined = project.setting;
  const sceneNarrator: string | undefined = scene.card.narrator;
  const defaultNarrator: string | undefined = setting?.narration?.defaultNarrator;
  const referencesNarratorCard: boolean =
    sceneNarrator !== undefined ||
    chapterDefaults.narrator !== undefined ||
    defaultNarrator !== undefined;

  return resolveNarration({
    ...(sceneNarrator === undefined ? {} : { sceneNarrator }),
    ...(chapterDefaults.narrator === undefined
      ? {}
      : { chapterNarrator: chapterDefaults.narrator }),
    ...(defaultNarrator === undefined ? {} : { defaultNarrator }),
    ...(setting?.pov === undefined ? {} : { pov: setting.pov }),
    ...(scene.frontmatter.povCharacter === undefined
      ? {}
      : { focalFallback: scene.frontmatter.povCharacter }),
    ...(referencesNarratorCard ? { narrators: await loadNarratorCards(paths, fileSystem) } : {}),
  });
}
