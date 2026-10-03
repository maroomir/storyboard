// 장별 요약은 그 장 본문에서 뽑은 것이므로, 본문이 바뀌면 요약도 낡는다. 어느 본문에서 나왔는지를
// 섹션마다 주석으로 남겨 두는 것이 그 판정의 근거다. 마커를 story-model에 두는 이유는 요약을 쓰는
// 쪽(story-engine)과 씬 프롬프트로 읽는 쪽(sceneContext)이 같은 표기를 봐야 하기 때문이다.
const chapterInputPattern = /^<!--\s*chapter-input:\s*(\S+)(\s+stale)?\s*-->$/;

export function formatChapterInputComment(sourceHash: string, isStale: boolean): string {
  return `<!-- chapter-input: ${sourceHash}${isStale ? ' stale' : ''} -->`;
}

export interface ChapterInputMark {
  readonly sourceHash: string;
  readonly isStale: boolean;
}

export function parseChapterInputComment(line: string): ChapterInputMark | undefined {
  const match = chapterInputPattern.exec(line.trim());

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
