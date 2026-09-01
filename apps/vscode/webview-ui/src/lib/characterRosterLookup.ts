import type { CharacterRole, CharacterRosterEntry } from '@webview/lib/types';

export function buildCharacterRosterLookup(
  roster: readonly CharacterRosterEntry[],
): ReadonlyMap<string, CharacterRosterEntry> {
  return new Map(roster.map((entry) => [entry.id, entry]));
}

export function resolveCharacterDisplayName(
  id: string,
  lookup: ReadonlyMap<string, CharacterRosterEntry>,
): { readonly displayName: string; readonly isKnown: boolean; readonly role?: CharacterRole } {
  const entry = lookup.get(id);

  if (entry) {
    return {
      displayName: entry.name,
      isKnown: true,
      ...(entry.role === undefined ? {} : { role: entry.role }),
    };
  }

  return { displayName: id, isKnown: false };
}
