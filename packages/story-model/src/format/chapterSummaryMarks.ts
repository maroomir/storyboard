const chapterInputPattern: RegExp = /^<!--\s*chapter-input:\s*(\S+)(\s+stale)?\s*-->$/;

export function formatChapterInputComment(sourceHash: string, isStale: boolean): string {
  return `<!-- chapter-input: ${sourceHash}${isStale ? ' stale' : ''} -->`;
}

export interface ChapterInputMark {
  readonly sourceHash: string;
  readonly isStale: boolean;
}

export function parseChapterInputComment(line: string): ChapterInputMark | undefined {
  const match: RegExpExecArray | null = chapterInputPattern.exec(line.trim());

  if (!match) {
    return undefined;
  }

  return { sourceHash: match[1] as string, isStale: match[2] !== undefined };
}

export function isChapterInputComment(line: string): boolean {
  return parseChapterInputComment(line) !== undefined;
}

export function isStaleChapterSection(section: string): boolean {
  return section.split('\n').some((line) => parseChapterInputComment(line)?.isStale === true);
}
