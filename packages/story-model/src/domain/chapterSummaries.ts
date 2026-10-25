import {
  formatChapterInputComment,
  isChapterInputComment,
  parseChapterInputComment,
  type ChapterInputMark,
} from '#model/format/chapterSummaryMarks';

export interface ChapterSummary {
  readonly chapterTitle: string;
  readonly summary: string;
  readonly sourceHash?: string;
  readonly isStale?: boolean;
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
    const previousSummary: string | undefined = index > 0 ? summaries[index - 1]?.summary : undefined;
    const recap: string = previousSummary ? `**이전 장 recap:** ${previousSummary}\n\n` : '';
    const mark: string =
      chapter.sourceHash === undefined
        ? ''
        : `${formatChapterInputComment(chapter.sourceHash, chapter.isStale === true)}\n\n`;
    sections.push(`## ${chapter.chapterTitle}\n\n${mark}${recap}${chapter.summary}`);
  });

  return `${sections.join('\n\n')}\n`;
}

const recapPrefix: string = '**이전 장 recap:**';

export function parseChapterSummariesMarkdown(markdown: string): ChapterSummary[] {
  return markdown
    .split(/^## /m)
    .slice(1)
    .flatMap((section) => {
      const [heading, ...rest] = section.split('\n');
      const chapterTitle: string | undefined = heading?.trim();

      if (chapterTitle === undefined || chapterTitle.length === 0) {
        return [];
      }

      const mark: ChapterInputMark | undefined = rest.map((line) => parseChapterInputComment(line)).find(Boolean);
      const summary: string = rest
        .filter((line) => !line.startsWith(recapPrefix) && !isChapterInputComment(line))
        .join('\n')
        .trim();

      if (summary.length === 0) {
        return [];
      }

      return [
        {
          chapterTitle,
          summary,
          ...(mark === undefined ? {} : { sourceHash: mark.sourceHash, isStale: mark.isStale }),
        },
      ];
    });
}

export function mergeChapterSummary(
  summaries: readonly ChapterSummary[],
  updated: ChapterSummary,
): ChapterSummary[] {
  const index: number = summaries.findIndex((entry) => entry.chapterTitle === updated.chapterTitle);

  if (index < 0) {
    return [...summaries, updated];
  }

  return summaries.map((entry, position) => (position === index ? updated : entry));
}

export interface ChapterSummaryAudit {
  readonly summaries: readonly ChapterSummary[];
  readonly staleChapterTitles: readonly string[];
  readonly unsealedChapterTitles: readonly string[];
}

export function auditChapterSummaries(
  summaries: readonly ChapterSummary[],
  currentSourceHashes: ReadonlyMap<string, string>,
): ChapterSummaryAudit {
  const staleChapterTitles: string[] = [];
  const unsealedChapterTitles: string[] = [];

  const audited: ChapterSummary[] = summaries.map((chapter) => {
    if (chapter.sourceHash === undefined) {
      unsealedChapterTitles.push(chapter.chapterTitle);
      return chapter;
    }

    const isStale: boolean = currentSourceHashes.get(chapter.chapterTitle) !== chapter.sourceHash;
    if (isStale) {
      staleChapterTitles.push(chapter.chapterTitle);
    }

    return chapter.isStale === isStale ? chapter : { ...chapter, isStale };
  });

  return { summaries: audited, staleChapterTitles, unsealedChapterTitles };
}

export function formatChapterSummaryStaleWarning(
  audit: ChapterSummaryAudit,
): string | undefined {
  if (audit.staleChapterTitles.length === 0) {
    return undefined;
  }

  return `장별 요약 ${audit.staleChapterTitles.length}개가 지금의 초안과 어긋납니다 (${audit.staleChapterTitles.join(', ')}). 프롬프트에서 제외했습니다 — 해당 장을 다시 요약하면 사라집니다.`;
}
