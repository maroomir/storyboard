import type { CharacterRole, CharacterRosterEntry } from '@webview/lib/types';

export function buildCharacterRosterLookup(
  roster: readonly CharacterRosterEntry[],
): ReadonlyMap<string, CharacterRosterEntry> {
  return new Map(roster.map((entry) => [entry.id, entry]));
}

export interface CharacterDisplayName {
  readonly displayName: string;
  readonly isKnown: boolean;
  readonly role?: CharacterRole;
}

export function resolveCharacterDisplayName(
  id: string,
  lookup: ReadonlyMap<string, CharacterRosterEntry>,
): CharacterDisplayName {
  const entry: CharacterRosterEntry | undefined = lookup.get(id);

  if (entry) {
    return {
      displayName: entry.name,
      isKnown: true,
      ...(entry.role === undefined ? {} : { role: entry.role }),
    };
  }

  return { displayName: id, isKnown: false };
}
