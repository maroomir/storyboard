import type {
  ChapterOutline,
  ChapterOutlineChapter,
} from '#model/format/chapterOutline';
import type { ChapterPlan, ChapterPlanChapter, ScenePlan } from '#model/format/outline';
import { outlineVersion } from '#model/format/outline';
import type { SceneFile } from '#model/format/scene';

export function scenePlanOfScene(scene: SceneFile): ScenePlan {
  const { card } = scene;

  return {
    id: scene.slug,
    title: card.title ?? scene.slug,
    purpose: card.purpose ?? '',
    characters: [...(card.characters ?? [])],
    foreshadowing: [...(card.foreshadowing ?? [])],
    ...(card.location === undefined ? {} : { location: card.location }),
    ...(card.conflict === undefined ? {} : { conflict: card.conflict }),
    ...(card.twist === undefined ? {} : { twist: card.twist }),
    ...(card.emotionalShift === undefined ? {} : { emotionalShift: card.emotionalShift }),
    ...(card.targetWordCount === undefined ? {} : { targetWordCount: card.targetWordCount }),
  };
}

function chapterHeader(chapter: ChapterOutlineChapter | ChapterPlanChapter): Omit<ChapterOutlineChapter, 'scenes'> {
  return {
    id: chapter.id,
    title: chapter.title,
    ...(chapter.summary === undefined ? {} : { summary: chapter.summary }),
    ...(chapter.targetWordCount === undefined ? {} : { targetWordCount: chapter.targetWordCount }),
    ...(chapter.narrator === undefined ? {} : { narrator: chapter.narrator }),
    ...(chapter.thread === undefined ? {} : { thread: chapter.thread }),
  };
}

export function projectChapterPlan(
  outline: ChapterOutline,
  scenePlanOf: (sceneId: string) => ScenePlan | undefined,
): ChapterPlan {
  return {
    version: outlineVersion,
    acts: outline.acts.map((act) => ({
      id: act.id,
      title: act.title,
      ...(act.summary === undefined ? {} : { summary: act.summary }),
      chapters: act.chapters.map((chapter) => ({
        ...chapterHeader(chapter),
        scenes: chapter.scenes.flatMap((sceneId): ScenePlan[] => {
          const plan: ScenePlan | undefined = scenePlanOf(sceneId);
          return plan === undefined ? [] : [plan];
        }),
      })),
    })),
  };
}

export function outlineOfChapterPlan(
  plan: ChapterPlan,
  sceneIdAt: (flatIndex: number) => string | undefined,
): ChapterOutline {
  let flatIndex: number = 0;

  return {
    version: outlineVersion,
    acts: plan.acts.map((act) => ({
      id: act.id,
      title: act.title,
      ...(act.summary === undefined ? {} : { summary: act.summary }),
      chapters: act.chapters.map((chapter) => ({
        ...chapterHeader(chapter),
        scenes: chapter.scenes.flatMap((): string[] => {
          const sceneId: string | undefined = sceneIdAt(flatIndex);
          flatIndex += 1;
          return sceneId === undefined ? [] : [sceneId];
        }),
      })),
    })),
  };
}

export function isChapterOutlineUnseeded(outline: ChapterOutline): boolean {
  return outline.acts.every((act) => act.chapters.every((chapter) => chapter.scenes.length === 0));
}
