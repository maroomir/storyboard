const foreignScriptRanges: string =
  '\\u0400-\\u04FF\\u0500-\\u052F\\u0590-\\u05FF\\u0600-\\u06FF\\u0900-\\u097F\\u0980-\\u09FF\\u0E00-\\u0E7F';

// eslint-disable-next-line no-misleading-character-class -- code point ranges, not combined characters
export const foreignScriptPattern: RegExp = new RegExp(`[${foreignScriptRanges}]`);

export interface ForeignScriptSpan {
  readonly index: number;
  readonly text: string;
  readonly excerpt: string;
}

const excerptRadius: number = 30;

export function findForeignScriptSpans(text: string): ForeignScriptSpan[] {
  // eslint-disable-next-line no-misleading-character-class -- code point ranges, not combined characters
  const runPattern: RegExp = new RegExp(`[${foreignScriptRanges}]+`, 'g');
  const spans: ForeignScriptSpan[] = [];

  for (const match of text.matchAll(runPattern)) {
    const index: number = match.index ?? 0;
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

export function stripForeignScript(text: string): string {
  // eslint-disable-next-line no-misleading-character-class -- code point ranges, not combined characters
  const runPattern: RegExp = new RegExp(`[${foreignScriptRanges}]+`, 'g');
  return text.replace(runPattern, '').replace(/[ \t]{2,}/g, ' ');
}
