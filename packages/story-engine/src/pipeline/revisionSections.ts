import { countSharedShingles, normalizeForMatch } from './textMatch';

export interface DraftSections {
  readonly sections: readonly string[];
  readonly breakLines: readonly string[];
}

function isSceneBreakLine(line: string): boolean {
  return line.trim() === '---';
}

export function splitDraftSections(body: string): DraftSections {
  const sections: string[] = [];
  const breakLines: string[] = [];
  let current: string[] = [];

  for (const line of body.split('\n')) {
    if (isSceneBreakLine(line)) {
      sections.push(current.join('\n'));
      breakLines.push(line);
      current = [];
      continue;
    }

    current.push(line);
  }

  sections.push(current.join('\n'));
  return { sections, breakLines };
}

export function joinDraftSections(split: DraftSections): string {
  return split.sections
    .map((section, index) => {
      const breakLine: string | undefined = split.breakLines[index];
      return breakLine === undefined ? section : `${section}\n${breakLine}\n`;
    })
    .join('');
}

export function replaceSectionText(original: string, rewritten: string): string {
  const leading: string = /^\s*/.exec(original)?.[0] ?? '';
  const trailing: string = /\s*$/.exec(original)?.[0] ?? '';
  return `${leading}${rewritten.trim()}${trailing}`;
}

function longestFragment(quote: string): string {
  const fragments: string[] = quote
    .split(/…|\.\.\./)
    .map((fragment) => fragment.trim())
    .filter((fragment) => fragment.length > 0);

  return fragments.reduce(
    (longest, fragment) => (fragment.length > longest.length ? fragment : longest),
    fragments[0] ?? '',
  );
}

export function locateQuoteSection(
  sections: readonly string[],
  quote: string | undefined,
): number | undefined {
  const fragment: string = longestFragment(quote ?? '');
  if (fragment.length === 0) {
    return undefined;
  }

  const verbatim: number = sections.findIndex((section) => section.includes(fragment));
  if (verbatim >= 0) {
    return verbatim;
  }

  const needle: string = normalizeForMatch(fragment);
  if (needle.length === 0) {
    return undefined;
  }

  const normalizedSections: string[] = sections.map(normalizeForMatch);
  const normalized: number = normalizedSections.findIndex((section) => section.includes(needle));
  if (normalized >= 0) {
    return normalized;
  }

  let bestIndex: number | undefined;
  let bestScore: number = 0;

  normalizedSections.forEach((section, index) => {
    const score: number = countSharedShingles(needle, section);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestIndex;
}
