import { countSharedShingles, normalizeForMatch } from './textMatch';

// A draft is rewritten one scene-break section at a time (#114, #115): one call over a whole 40,000
// character draft outran the provider timeout, and a single rejected candidate threw every fix
// away. The review still reads the whole draft once; its issues are attributed to sections here.

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
      const breakLine = split.breakLines[index];
      return breakLine === undefined ? section : `${section}\n${breakLine}\n`;
    })
    .join('');
}

// The rewrite answers with the section's text alone; the blank lines around it belong to the
// joins, so the original's are kept and a section never grows or loses the gap to its neighbours.
export function replaceSectionText(original: string, rewritten: string): string {
  const leading = /^\s*/.exec(original)?.[0] ?? '';
  const trailing = /\s*$/.exec(original)?.[0] ?? '';
  return `${leading}${rewritten.trim()}${trailing}`;
}

function longestFragment(quote: string): string {
  const fragments = quote
    .split(/…|\.\.\./)
    .map((fragment) => fragment.trim())
    .filter((fragment) => fragment.length > 0);

  return fragments.reduce((longest, fragment) =>
    fragment.length > longest.length ? fragment : longest,
  fragments[0] ?? '');
}

// Finds the section a quoted excerpt came from: verbatim first, then ignoring spacing and
// punctuation, then the section sharing the most four-character runs with it. A model often
// paraphrases or elides when it quotes, so the last step is what places most loose quotes.
export function locateQuoteSection(
  sections: readonly string[],
  quote: string | undefined,
): number | undefined {
  const fragment = longestFragment(quote ?? '');
  if (fragment.length === 0) {
    return undefined;
  }

  const verbatim = sections.findIndex((section) => section.includes(fragment));
  if (verbatim >= 0) {
    return verbatim;
  }

  const needle = normalizeForMatch(fragment);
  if (needle.length === 0) {
    return undefined;
  }

  const normalizedSections = sections.map(normalizeForMatch);
  const normalized = normalizedSections.findIndex((section) => section.includes(needle));
  if (normalized >= 0) {
    return normalized;
  }

  let bestIndex: number | undefined;
  let bestScore = 0;

  normalizedSections.forEach((section, index) => {
    const score = countSharedShingles(needle, section);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestIndex;
}
