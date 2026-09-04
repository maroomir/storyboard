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
