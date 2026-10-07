import { normalizeCardListText } from '#model/domain/cardCollect';
import type { CardCollectProposal } from '#model/shared/cardCollect';
import type {
  NoteCandidateFile,
  NoteCandidateSource,
  NoteCardCandidate,
} from '#model/shared/noteAbsorb';

export const emptyNoteCandidateFile: NoteCandidateFile = { version: 2, sources: [] };

// A keyed change sets one slot of a card, so two notes can disagree about it. The value is what
// they disagree on.
function keyedChangeValue(change: CardCollectProposal): string | undefined {
  switch (change.kind) {
    case 'attribute':
      return change.value;
    case 'relation':
      return change.type;
    case 'arc':
      return change.summary;
    case 'scalar':
      return change.after;
    default:
      return undefined;
  }
}

// Two changes with one identity say the same thing: a keyed change by its slot and value, a list
// item by its text under the shared spacing-and-punctuation rule, a card id exactly.
function noteChangeIdentity(change: CardCollectProposal): string {
  switch (change.kind) {
    case 'attribute':
    case 'relation':
    case 'arc':
    case 'scalar':
      return `${change.id}\u0000${keyedChangeValue(change)}`;
    case 'characterId':
      return change.id;
    default:
      return `${change.kind}:${normalizeCardListText(change.value)}`;
  }
}

// What `card discard --change` takes: the source that proposed a change and the change's id.
export function noteChangeRef(sourceId: string, change: CardCollectProposal): string {
  return `${sourceId}:${change.id}`;
}

export interface NoteCandidateConflictOption {
  readonly ref: string;
  readonly value: string;
  readonly locations: readonly string[];
  readonly change: CardCollectProposal;
}

export interface NoteCandidateConflict {
  readonly key: string;
  readonly options: readonly NoteCandidateConflictOption[];
}

export interface MergedNoteCardCandidate extends NoteCardCandidate {
  readonly locations: readonly string[];
  // Slots the notes disagree on. They are never promoted until the author discards all but one.
  readonly conflicts: readonly NoteCandidateConflict[];
}

interface ChangeOccurrence {
  readonly sourceId: string;
  readonly location: string;
  readonly change: CardCollectProposal;
}

interface CardAccumulator {
  readonly candidate: NoteCardCandidate;
  readonly sourceNotes: string[];
  readonly locations: string[];
  readonly occurrences: ChangeOccurrence[];
}

function addUnique(list: string[], values: readonly string[]): void {
  for (const value of values) {
    if (!list.includes(value)) {
      list.push(value);
    }
  }
}

// One entry per card across every source, oldest source first. Changes that say the same thing
// become one (their scenes joined); keyed slots with more than one value become conflicts.
export function mergeNoteCandidateSources(
  sources: readonly NoteCandidateSource[],
): MergedNoteCardCandidate[] {
  const cards = new Map<string, CardAccumulator>();

  for (const source of sources) {
    for (const candidate of source.candidates) {
      const accumulator = cards.get(candidate.cardId) ?? {
        candidate,
        sourceNotes: [],
        locations: [],
        occurrences: [],
      };
      cards.set(candidate.cardId, accumulator);
      addUnique(accumulator.sourceNotes, candidate.sourceNotes);
      addUnique(accumulator.locations, [source.location]);
      accumulator.occurrences.push(
        ...candidate.changes.map((change) => ({
          sourceId: source.id,
          location: source.location,
          change,
        })),
      );
    }
  }

  return [...cards.values()].map(mergeCardOccurrences);
}

function mergeCardOccurrences(accumulator: CardAccumulator): MergedNoteCardCandidate {
  const byIdentity = new Map<
    string,
    { change: CardCollectProposal; occurrences: ChangeOccurrence[] }
  >();

  for (const occurrence of accumulator.occurrences) {
    const identity = noteChangeIdentity(occurrence.change);
    const existing = byIdentity.get(identity);

    if (existing === undefined) {
      byIdentity.set(identity, { change: occurrence.change, occurrences: [occurrence] });
      continue;
    }

    const sourceScenes = [...existing.change.sourceScenes];
    addUnique(sourceScenes, occurrence.change.sourceScenes);
    existing.change = { ...existing.change, sourceScenes };
    existing.occurrences.push(occurrence);
  }

  const groupsByKey = new Map<
    string,
    { change: CardCollectProposal; occurrences: ChangeOccurrence[] }[]
  >();

  for (const group of byIdentity.values()) {
    const groups = groupsByKey.get(group.change.id) ?? [];
    groups.push(group);
    groupsByKey.set(group.change.id, groups);
  }

  const changes: CardCollectProposal[] = [];
  const conflicts: NoteCandidateConflict[] = [];

  for (const [key, groups] of groupsByKey) {
    const [only] = groups;

    if (groups.length === 1 && only !== undefined) {
      changes.push(only.change);
      continue;
    }

    conflicts.push({
      key,
      options: groups.map((group) => {
        const [first] = group.occurrences;
        return {
          ref: noteChangeRef(first?.sourceId ?? '', group.change),
          value: keyedChangeValue(group.change) ?? '',
          locations: [...new Set(group.occurrences.map((occurrence) => occurrence.location))],
          change: group.change,
        };
      }),
    });
  }

  return {
    ...accumulator.candidate,
    sourceNotes: accumulator.sourceNotes,
    locations: accumulator.locations,
    changes,
    conflicts,
  };
}

function withoutEmptyEntries(sources: readonly NoteCandidateSource[]): NoteCandidateFile {
  return {
    version: 2,
    sources: sources
      .map((source) => ({
        ...source,
        candidates: source.candidates.filter((candidate) => candidate.changes.length > 0),
      }))
      .filter((source) => source.candidates.length > 0),
  };
}

function nextSourceId(sources: readonly NoteCandidateSource[]): string {
  const highest = sources.reduce(
    (max, source) => Math.max(max, Number.parseInt(source.id.slice(1), 10)),
    0,
  );

  return `s${highest + 1}`;
}

// An absorb's candidates join the file: they replace what the same location left before, or every
// note candidate when the author asked to start over.
export function addNoteCandidateSource(
  file: NoteCandidateFile,
  absorbed: Omit<NoteCandidateSource, 'id'>,
  shouldReplaceAll: boolean,
): NoteCandidateFile {
  const kept = shouldReplaceAll
    ? []
    : file.sources.filter((source) => source.location !== absorbed.location);

  return withoutEmptyEntries([...kept, { id: nextSourceId(file.sources), ...absorbed }]);
}

function mapCardChanges(
  file: NoteCandidateFile,
  cardId: string,
  keepChange: (change: CardCollectProposal, sourceId: string) => boolean,
): NoteCandidateFile {
  return withoutEmptyEntries(
    file.sources.map((source) => ({
      ...source,
      candidates: source.candidates.map((candidate) =>
        candidate.cardId === cardId
          ? {
              ...candidate,
              changes: candidate.changes.filter((change) => keepChange(change, source.id)),
            }
          : candidate,
      ),
    })),
  );
}

// After a card is promoted only its conflicts stay: everything else was applied or the card
// already had it.
export function keepNoteCandidateConflicts(
  file: NoteCandidateFile,
  card: MergedNoteCardCandidate,
): NoteCandidateFile {
  const conflictKeys = new Set(card.conflicts.map((conflict) => conflict.key));

  return mapCardChanges(file, card.cardId, (change) => conflictKeys.has(change.id));
}

export function removeNoteCandidateCards(
  file: NoteCandidateFile,
  cardIds: ReadonlySet<string> | undefined,
): NoteCandidateFile {
  if (cardIds === undefined) {
    return emptyNoteCandidateFile;
  }

  return withoutEmptyEntries(
    file.sources.map((source) => ({
      ...source,
      candidates: source.candidates.filter((candidate) => !cardIds.has(candidate.cardId)),
    })),
  );
}

// Drops the change a ref names, and the same change wherever another source proposed it too, so a
// discarded value does not come back from a second note.
export function removeNoteCandidateChange(
  file: NoteCandidateFile,
  cardId: string,
  ref: string,
): NoteCandidateFile | undefined {
  const [target] = file.sources.flatMap((source) =>
    source.candidates
      .filter((candidate) => candidate.cardId === cardId)
      .flatMap((candidate) => candidate.changes)
      .filter((change) => noteChangeRef(source.id, change) === ref),
  );

  if (target === undefined) {
    return undefined;
  }

  const identity = noteChangeIdentity(target);

  return mapCardChanges(file, cardId, (change) => noteChangeIdentity(change) !== identity);
}
