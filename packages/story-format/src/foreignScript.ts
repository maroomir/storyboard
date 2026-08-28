// NOTE: 한국어 원고 생성에서 다른 문자 체계가 토막으로 새어 나오는 일이 반복 관측됐다(벵골·키릴·아랍).
// 원고에 그대로 박히면 독자가 바로 알아보므로, 생성 직후 찾아내 경고할 수 있게 한 곳에 모아 둔다.
const foreignScriptRanges =
  '\\u0400-\\u04FF\\u0500-\\u052F\\u0590-\\u05FF\\u0600-\\u06FF\\u0900-\\u097F\\u0980-\\u09FF\\u0E00-\\u0E7F';

export const foreignScriptPattern = new RegExp(`[${foreignScriptRanges}]`);

export interface ForeignScriptSpan {
  readonly index: number;
  readonly text: string;
  readonly excerpt: string;
}

const excerptRadius = 30;

export function findForeignScriptSpans(text: string): ForeignScriptSpan[] {
  const runPattern = new RegExp(`[${foreignScriptRanges}]+`, 'g');
  const spans: ForeignScriptSpan[] = [];

  for (const match of text.matchAll(runPattern)) {
    const index = match.index ?? 0;
    spans.push({
      index,
      text: match[0],
      excerpt: text
        .slice(Math.max(0, index - excerptRadius), index + match[0].length + excerptRadius)
        .replace(/\s+/g, ' ')
        .trim(),
    });
  }

  return spans;
}

export function hasForeignScript(text: string): boolean {
  return foreignScriptPattern.test(text);
}

// NOTE: 오염된 원고의 꼬리가 다음 씬 프롬프트로 실려 같은 낱말이 되풀이 생성되는 경로가 확인됐다
// (1화 말미의 아랍어가 2화에 그대로 재생산). 원고 자체는 건드리지 않고, 맥락으로 넘길 때만 걷어낸다.
export function stripForeignScript(text: string): string {
  const runPattern = new RegExp(`[${foreignScriptRanges}]+`, 'g');
  return text.replace(runPattern, '').replace(/[ \t]{2,}/g, ' ');
}
