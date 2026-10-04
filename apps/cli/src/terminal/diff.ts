import type { Theme } from './theme';

// 산문의 diff 는 줄이 아니라 문장 단위다. 한 문단이 한 줄인 초안에서 줄 diff 는 «문단 전체가
// 바뀌었다» 만 말해 준다.

export type DiffLine =
  | { readonly kind: 'same'; readonly text: string }
  | { readonly kind: 'removed'; readonly text: string }
  | { readonly kind: 'added'; readonly text: string }
  | { readonly kind: 'gap'; readonly count: number };

// A sentence ends at terminal punctuation (with any closing quote) or a line break.
export function splitSentences(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?。…][”"’'」』)]*)\s+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

// Longest common subsequence over sentences; drafts are a few hundred sentences, so the quadratic
// table is small.
function diffSequences(before: readonly string[], after: readonly string[]): DiffLine[] {
  const rows = before.length;
  const columns = after.length;
  const table = Array.from({ length: rows + 1 }, () => new Array<number>(columns + 1).fill(0));

  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = columns - 1; j >= 0; j -= 1) {
      table[i]![j] =
        before[i] === after[j]
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }

  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;

  while (i < rows || j < columns) {
    if (i < rows && j < columns && before[i] === after[j]) {
      lines.push({ kind: 'same', text: before[i]! });
      i += 1;
      j += 1;
    } else if (i < rows && (j === columns || table[i + 1]![j]! >= table[i]![j + 1]!)) {
      // Removed before added, as a reader expects «what was» above «what is».
      lines.push({ kind: 'removed', text: before[i]! });
      i += 1;
    } else {
      lines.push({ kind: 'added', text: after[j]! });
      j += 1;
    }
  }

  return lines;
}

// Changes with `context` unchanged sentences around each; longer unchanged runs fold into a gap.
export function diffSentences(before: string, after: string, context = 1): DiffLine[] {
  const lines = diffSequences(splitSentences(before), splitSentences(after));
  const isNearChange = lines.map((_, index) =>
    lines
      .slice(Math.max(0, index - context), index + context + 1)
      .some((line) => line.kind !== 'same'),
  );
  const shown: DiffLine[] = [];

  lines.forEach((line, index) => {
    if (line.kind !== 'same' || isNearChange[index]) {
      shown.push(line);
      return;
    }

    const last = shown[shown.length - 1];
    if (last?.kind === 'gap') {
      shown[shown.length - 1] = { kind: 'gap', count: last.count + 1 };
    } else {
      shown.push({ kind: 'gap', count: 1 });
    }
  });

  return shown;
}

export interface DiffCount {
  readonly added: number;
  readonly removed: number;
}

export function countChanges(lines: readonly DiffLine[]): DiffCount {
  return {
    added: lines.filter((line) => line.kind === 'added').length,
    removed: lines.filter((line) => line.kind === 'removed').length,
  };
}

// The rendered view: a heading with the counts, then at most `limit` lines of the diff.
export function renderSentenceDiff(
  title: string,
  lines: readonly DiffLine[],
  theme: Theme,
  limit = 40,
): string[] {
  const { added, removed } = countChanges(lines);
  const body = lines.slice(0, limit).map((line) => {
    switch (line.kind) {
      case 'added':
        return theme.paint('success', `+ ${line.text}`);
      case 'removed':
        return theme.paint('danger', `- ${line.text}`);
      case 'same':
        return theme.paint('muted', `  ${line.text}`);
      case 'gap':
        return theme.paint('muted', `  … ${line.count}문장 같음`);
    }
  });

  return [
    `${theme.paint('heading', title)}  ${theme.paint('success', `+${added}`)} ${theme.paint('danger', `-${removed}`)}`,
    ...body,
    ...(lines.length > limit ? [theme.paint('muted', `  … ${lines.length - limit}줄 더`)] : []),
  ];
}
