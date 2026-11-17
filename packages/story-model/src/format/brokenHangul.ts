import { commonHangulSyllables } from '#model/format/commonHangulSyllables';

export interface BrokenHangulSpan {
  readonly index: number;
  readonly text: string;
  readonly excerpt: string;
}

const excerptRadius: number = 15;
const compatibilityJamoRunPattern: RegExp = /[ㄱ-ㆎ]+/g;
const shortestExpressiveJamoRunLength: number = 2;

function extractExcerpt(text: string, index: number, length: number): string {
  return text
    .slice(Math.max(0, index - excerptRadius), index + length + excerptRadius)
    .replace(/\s+/g, ' ')
    .trim();
}

export function findBrokenHangulSpans(text: string): BrokenHangulSpan[] {
  const spans: BrokenHangulSpan[] = [];

  for (const match of text.matchAll(compatibilityJamoRunPattern)) {
    const isExpressiveRun: boolean = match[0].length >= shortestExpressiveJamoRunLength;
    if (isExpressiveRun) {
      continue;
    }

    const index: number = match.index ?? 0;
    spans.push({
      index,
      text: match[0],
      excerpt: extractExcerpt(text, index, match[0].length),
    });
  }

  return spans;
}

const hangulSyllablePattern: RegExp = /[가-힣]/g;

export function findRareHangulSyllableSpans(
  text: string,
  allowedText: string = '',
): BrokenHangulSpan[] {
  const allowed: Set<string> = new Set<string>(allowedText.match(hangulSyllablePattern) ?? []);
  const spans: BrokenHangulSpan[] = [];

  for (const match of text.matchAll(hangulSyllablePattern)) {
    const syllable: string = match[0];
    const isExpected: boolean = commonHangulSyllables.has(syllable) || allowed.has(syllable);
    if (isExpected) {
      continue;
    }

    const index: number = match.index ?? 0;
    spans.push({ index, text: syllable, excerpt: extractExcerpt(text, index, syllable.length) });
  }

  return spans;
}

export function findBrokenGlyphSpans(text: string, allowedText: string = ''): BrokenHangulSpan[] {
  return [...findBrokenHangulSpans(text), ...findRareHangulSyllableSpans(text, allowedText)].sort(
    (left, right) => left.index - right.index,
  );
}
