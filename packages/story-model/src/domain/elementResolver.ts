import { isElementId } from '#model/element/elementId';
import { isElementKind, type ElementKind } from '#model/element/elementKind';
import { parseNumberedSceneStem, type NumberedSceneStem } from '#model/format/bundlePaths';

export interface ElementIndexEntry {
  readonly id: string;
  readonly kind: ElementKind;
  readonly slug: string;
  readonly path: string;
  readonly sceneNumber?: number;
}

export type ElementResolution =
  | { readonly kind: 'found'; readonly entry: ElementIndexEntry }
  | { readonly kind: 'missing' }
  | { readonly kind: 'ambiguous'; readonly entries: readonly ElementIndexEntry[] }
  | { readonly kind: 'copied'; readonly entries: readonly ElementIndexEntry[] };

export interface ElementQuery {
  readonly text: string;
  readonly kind?: ElementKind;
}

const kindPrefixSeparator: string = ':';

const sceneNumberOnlyPattern: RegExp = /^\d+$/;

function splitKindPrefix(query: ElementQuery): ElementQuery {
  const separatorIndex: number = query.text.indexOf(kindPrefixSeparator);
  const prefix: string = query.text.slice(0, separatorIndex);
  if (separatorIndex > 0 && isElementKind(prefix)) {
    return { text: query.text.slice(separatorIndex + 1), kind: prefix };
  }

  return query;
}

function matchSceneNumber(entry: ElementIndexEntry, text: string): boolean {
  return entry.kind === 'scene' && entry.sceneNumber === Number(text);
}

function matchEntry(entry: ElementIndexEntry, text: string): boolean {
  if (isElementId(text)) {
    return entry.id === text;
  }

  if (sceneNumberOnlyPattern.test(text)) {
    return matchSceneNumber(entry, text);
  }

  const numberedStem: NumberedSceneStem | undefined =
    entry.kind === 'scene' ? parseNumberedSceneStem(text) : undefined;

  return entry.slug === (numberedStem?.slug ?? text);
}

function decideResolution(matches: readonly ElementIndexEntry[]): ElementResolution {
  const [firstMatch] = matches;
  if (firstMatch === undefined) {
    return { kind: 'missing' };
  }

  if (matches.length === 1) {
    return { kind: 'found', entry: firstMatch };
  }

  const isOneElementInSeveralFolders: boolean = matches.every(
    (entry) => entry.id === firstMatch.id,
  );

  return isOneElementInSeveralFolders
    ? { kind: 'copied', entries: matches }
    : { kind: 'ambiguous', entries: matches };
}

export function resolveElement(
  entries: readonly ElementIndexEntry[],
  query: ElementQuery,
): ElementResolution {
  const { text, kind }: ElementQuery = splitKindPrefix({ ...query, text: query.text.trim() });
  const matches: readonly ElementIndexEntry[] = entries.filter(
    (entry) => (kind === undefined || entry.kind === kind) && matchEntry(entry, text),
  );

  return decideResolution(matches);
}

export function findCopiedElementIds(
  entries: readonly ElementIndexEntry[],
): readonly (readonly ElementIndexEntry[])[] {
  const entriesById: Map<string, ElementIndexEntry[]> = new Map<string, ElementIndexEntry[]>();
  for (const entry of entries) {
    entriesById.set(entry.id, [...(entriesById.get(entry.id) ?? []), entry]);
  }

  return [...entriesById.values()].filter((group) => group.length > 1);
}
