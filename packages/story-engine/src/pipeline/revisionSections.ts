import { countSharedShingles, normalizeForMatch } from '#engine/pipeline/textMatch';

export interface DraftSections {
  readonly sections: readonly string[];
  readonly separators: readonly string[];
}

export interface DraftSectionSplitOptions {
  readonly maxSectionChars?: number;
}

const paragraphBreak: string = '\n\n';
const lineBreak: string = '\n';
const separatorBetweenParts: string = '';

function isSceneBreakLine(line: string): boolean {
  return line.trim() === '---';
}

function findBreakEndNearest(text: string, breakToken: string, idealCut: number): number {
  const before: number = text.lastIndexOf(breakToken, idealCut);
  const after: number = text.indexOf(breakToken, idealCut);
  const hasBefore: boolean = before >= 0;
  const hasAfter: boolean = after >= 0;

  if (!hasBefore && !hasAfter) {
    return text.length;
  }

  const isBeforeCloser: boolean = hasBefore && (!hasAfter || idealCut - before <= after - idealCut);
  return (isBeforeCloser ? before : after) + breakToken.length;
}

export function splitSectionIntoParts(section: string, maxSectionChars: number): string[] {
  if (section.length <= maxSectionChars) {
    return [section];
  }

  const breakToken: string = section.includes(paragraphBreak) ? paragraphBreak : lineBreak;
  const partCount: number = Math.ceil(section.length / maxSectionChars);
  const parts: string[] = [];
  let partStart: number = 0;

  for (let partNumber: number = 1; partNumber < partCount; partNumber += 1) {
    const idealCut: number = Math.round((section.length * partNumber) / partCount);
    const cut: number = findBreakEndNearest(section, breakToken, idealCut);
    const isUsableCut: boolean = cut > partStart && cut < section.length;

    if (isUsableCut && section.slice(partStart, cut).trim().length > 0) {
      parts.push(section.slice(partStart, cut));
      partStart = cut;
    }
  }

  parts.push(section.slice(partStart));
  return parts;
}

function splitAtSceneBreaks(body: string): DraftSections {
  const sections: string[] = [];
  const separators: string[] = [];
  let current: string[] = [];

  for (const line of body.split('\n')) {
    if (isSceneBreakLine(line)) {
      sections.push(current.join('\n'));
      separators.push(`\n${line}\n`);
      current = [];
      continue;
    }

    current.push(line);
  }

  sections.push(current.join('\n'));
  return { sections, separators };
}

export function splitDraftSections(
  body: string,
  options: DraftSectionSplitOptions = {},
): DraftSections {
  const scenes: DraftSections = splitAtSceneBreaks(body);
  const { maxSectionChars } = options;
  if (maxSectionChars === undefined) {
    return scenes;
  }

  const sections: string[] = [];
  const separators: string[] = [];

  scenes.sections.forEach((scene, sceneIndex) => {
    const parts: string[] = splitSectionIntoParts(scene, maxSectionChars);
    const sceneSeparator: string | undefined = scenes.separators[sceneIndex];

    sections.push(...parts);
    separators.push(...parts.slice(1).map((): string => separatorBetweenParts));
    if (sceneSeparator !== undefined) {
      separators.push(sceneSeparator);
    }
  });

  return { sections, separators };
}

export function joinDraftSections(split: DraftSections): string {
  return split.sections
    .map((section, index) => `${section}${split.separators[index] ?? ''}`)
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
