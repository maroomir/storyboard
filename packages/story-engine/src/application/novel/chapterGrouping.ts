import { buildSceneSeeds, flattenChapterPlan } from '@storyboard/story-model';
import type { ChapterPlan, FlatChapterScene, GeneratedSceneSeed } from '@storyboard/story-model';

interface ChapterStemGroup {
  title: string;
  stems: string[];
  actIndex: number;
  chapterIndex: number;
}

export interface ChapterGroup {
  readonly title: string;
  readonly stems: readonly string[];
}

export function groupChapterStems(
  plan: ChapterPlan,
  digitCount: number,
  sceneStemsByOrder: ReadonlyMap<number, string> = new Map(),
): ChapterGroup[] {
  const seeds: GeneratedSceneSeed[] = buildSceneSeeds(plan, digitCount);
  const flat: FlatChapterScene[] = flattenChapterPlan(plan);
  const groups: ChapterStemGroup[] = [];

  flat.forEach((flatScene, index) => {
    const stem: string | undefined = sceneStemsByOrder.get(index + 1) ?? seeds[index]?.stem;
    if (stem === undefined) {
      return;
    }

    const last: ChapterStemGroup | undefined = groups.at(-1);
    if (
      last &&
      last.actIndex === flatScene.actIndex &&
      last.chapterIndex === flatScene.chapterIndex
    ) {
      last.stems.push(stem);
      return;
    }
    groups.push({
      title: flatScene.chapterTitle,
      stems: [stem],
      actIndex: flatScene.actIndex,
      chapterIndex: flatScene.chapterIndex,
    });
  });

  return groups.map(({ title, stems }) => ({ title, stems }));
}
