import {
  flattenChapterPlan,
  readChapterPlanFile,
  resolveNarration,
  type NarrationDirective,
  type SceneFile,
  type StoryboardProject,
} from '@storyboard/story-format';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type { StoryboardProjectPaths } from '#engine/paths/projectPaths';
import { loadNarratorCards } from '#engine/persistence/narratorCards';

// 장이 씬에 물려주는 값. 씬 카드가 같은 필드를 가지면 씬이 이긴다.
export interface ChapterNarrationDefaults {
  readonly narrator?: string;
  readonly thread?: string;
}

// NOTE: 씬 시드를 만들 때 장의 값이 씬 카드로 복사되므로 보통은 씬 카드만 봐도 된다. 손으로 쓴
// 아웃라인에서는 장에만 적혀 있을 수 있어, 계획이 있으면 그쪽도 읽어 기본값으로 쓴다.
export async function readChapterNarrationDefaults(
  paths: StoryboardProjectPaths,
  sceneOrder: number,
  fileSystem: IFileSystem,
): Promise<ChapterNarrationDefaults> {
  try {
    const plan = await readChapterPlanFile(paths.outlineChapters, fileSystem);
    const placement = flattenChapterPlan(plan)[sceneOrder - 1];

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
  const setting = project.setting;
  const sceneNarrator = scene.card.narrator;
  const defaultNarrator = setting?.narration?.defaultNarrator;
  const referencesNarratorCard =
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
    // 카드를 참조하지 않는 작품은 디렉터리를 읽지 않는다.
    ...(referencesNarratorCard ? { narrators: await loadNarratorCards(paths, fileSystem) } : {}),
  });
}
