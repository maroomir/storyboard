import { flattenChapterPlan } from '@seedkernel/wasm';
import type { ChapterPlan } from '@seedkernel/wasm';

export interface ForeshadowingEntry {
  readonly item: string;
  readonly sceneTitle: string;
  readonly sceneOrder: number;
}

export interface ForeshadowingChapter {
  readonly chapterTitle: string;
  readonly entries: ForeshadowingEntry[];
}

export function collectForeshadowing(plan: ChapterPlan): ForeshadowingChapter[] {
  const chapters: (ForeshadowingChapter & { actIndex: number; chapterIndex: number })[] = [];

  flattenChapterPlan(plan).forEach((flatScene, globalIndex) => {
    if (flatScene.scene.foreshadowing.length === 0) {
      return;
    }

    const chapter = reserveChapter(
      chapters,
      flatScene.actIndex,
      flatScene.chapterIndex,
      flatScene.chapterTitle,
    );

    for (const item of flatScene.scene.foreshadowing) {
      chapter.entries.push({
        item,
        sceneTitle: flatScene.scene.title,
        sceneOrder: globalIndex + 1,
      });
    }
  });

  return chapters.map(({ chapterTitle, entries }) => ({ chapterTitle, entries }));
}

export function countForeshadowing(chapters: readonly ForeshadowingChapter[]): number {
  return chapters.reduce((total, chapter) => total + chapter.entries.length, 0);
}

export function buildForeshadowingMarkdown(
  projectName: string,
  chapters: readonly ForeshadowingChapter[],
): string {
  const sections: string[] = ['# 복선 추적 (회수 대상)', `> 대상: ${projectName}`];

  if (countForeshadowing(chapters) === 0) {
    sections.push('등록된 복선이 없습니다.');
    return `${sections.join('\n\n')}\n`;
  }

  for (const chapter of chapters) {
    const lines = chapter.entries.map((entry) => `- [ ] ${entry.item} — ${entry.sceneTitle}`);
    sections.push(`## ${chapter.chapterTitle}\n\n${lines.join('\n')}`);
  }

  return `${sections.join('\n\n')}\n`;
}

function reserveChapter(
  chapters: (ForeshadowingChapter & { actIndex: number; chapterIndex: number })[],
  actIndex: number,
  chapterIndex: number,
  chapterTitle: string,
): ForeshadowingChapter {
  const last = chapters.at(-1);

  if (last && last.actIndex === actIndex && last.chapterIndex === chapterIndex) {
    return last;
  }

  const chapter = { chapterTitle, entries: [], actIndex, chapterIndex };
  chapters.push(chapter);
  return chapter;
}
