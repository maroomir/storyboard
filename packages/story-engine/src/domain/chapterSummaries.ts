import {
  formatChapterInputComment,
  isChapterInputComment,
  parseChapterInputComment,
} from '@storyboard/story-model';

export interface ChapterSummary {
  readonly chapterTitle: string;
  readonly summary: string;
  // 이 요약을 낳은 장 본문의 해시. 0.8 이전 요약에는 없으므로 대조할 근거가 없는 것으로 본다.
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
    const previousSummary = index > 0 ? summaries[index - 1]?.summary : undefined;
    const recap = previousSummary ? `**이전 장 recap:** ${previousSummary}\n\n` : '';
    const mark =
      chapter.sourceHash === undefined
        ? ''
        : `${formatChapterInputComment(chapter.sourceHash, chapter.isStale === true)}\n\n`;
    sections.push(`## ${chapter.chapterTitle}\n\n${mark}${recap}${chapter.summary}`);
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

      const mark = rest.map((line) => parseChapterInputComment(line)).find(Boolean);
      const summary = rest
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
  const index = summaries.findIndex((entry) => entry.chapterTitle === updated.chapterTitle);

  if (index < 0) {
    return [...summaries, updated];
  }

  return summaries.map((entry, position) => (position === index ? updated : entry));
}

// 원장(§4.10)과 같은 판정이다. 기록된 본문 해시와 지금의 장 본문 해시가 다르면 그 요약은 낡았다.
// 지우지 않고 표시만 하는 이유도 같다 — 사람이 무엇이 버려졌는지 볼 수 있어야 하고, 그 장을 다시
// 요약하면 통째로 갈아 끼워진다. 해시가 없는 0.8 이전 요약은 대조할 근거가 없으므로 유효로 둔다.
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

  const audited = summaries.map((chapter) => {
    if (chapter.sourceHash === undefined) {
      unsealedChapterTitles.push(chapter.chapterTitle);
      return chapter;
    }

    const isStale = currentSourceHashes.get(chapter.chapterTitle) !== chapter.sourceHash;
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
