export interface BrokenHangulSpan {
  readonly index: number;
  readonly text: string;
  readonly excerpt: string;
}

const excerptRadius: number = 15;
const compatibilityJamoRunPattern: RegExp = /[ㄱ-ㆎ]+/g;
const shortestExpressiveJamoRunLength: number = 2;

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
      excerpt: text
        .slice(Math.max(0, index - excerptRadius), index + match[0].length + excerptRadius)
        .replace(/\s+/g, ' ')
        .trim(),
    });
  }

  return spans;
}
