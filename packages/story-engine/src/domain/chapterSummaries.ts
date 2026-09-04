export interface ChapterSummary {
  readonly chapterTitle: string;
  readonly summary: string;
}

export function buildChapterSummariesMarkdown(
  projectName: string,
  summaries: readonly ChapterSummary[],
): string {
  const sections: string[] = ['# 장별 요약', `> 대상: ${projectName}`];

  if (summaries.length === 0) {
    sections.push('요약할 장이 없습니다.');
    return `${sections.join('\n\n')}\n`;
  }

  summaries.forEach((chapter, index) => {
    const previousSummary = index > 0 ? summaries[index - 1]?.summary : undefined;
    const recap = previousSummary ? `**이전 장 recap:** ${previousSummary}\n\n` : '';
    sections.push(`## ${chapter.chapterTitle}\n\n${recap}${chapter.summary}`);
  });

  return `${sections.join('\n\n')}\n`;
}

const recapPrefix = '**이전 장 recap:**';

// The rolling summary is rebuilt one chapter at a time while a run is still going, so the file has
// to be readable back into the sections it was written from. The recap line is derived from the
// previous chapter's summary at render time, so it is dropped here rather than stored twice.
export function parseChapterSummariesMarkdown(markdown: string): ChapterSummary[] {
  return markdown
    .split(/^## /m)
    .slice(1)
    .flatMap((section) => {
      const [heading, ...rest] = section.split('\n');
      const chapterTitle = heading?.trim();

      if (chapterTitle === undefined || chapterTitle.length === 0) {
        return [];
      }

      const summary = rest
        .join('\n')
        .split('\n')
        .filter((line) => !line.startsWith(recapPrefix))
        .join('\n')
        .trim();

      return summary.length === 0 ? [] : [{ chapterTitle, summary }];
    });
}

export function mergeChapterSummary(
  summaries: readonly ChapterSummary[],
  updated: ChapterSummary,
): ChapterSummary[] {
  const index = summaries.findIndex((entry) => entry.chapterTitle === updated.chapterTitle);

  if (index < 0) {
    return [...summaries, updated];
  }

  return summaries.map((entry, position) => (position === index ? updated : entry));
}
