import type {
  NoteExtraction,
  NoteExtractionEntity,
  NoteExtractionKnownCard,
  NoteExtractionScene,
} from '#model/contracts/noteExtraction';
import type { NoteSynthesis, NoteSynthesisSetting } from '#model/contracts/noteSynthesis';
import { cardIdPattern, type StoryboardCard } from '#model/format/card';
import { outlineSynopsisSchema, type OutlineSynopsis } from '#model/format/outline';
import { sceneFileNamePattern, type SceneCard, type SceneFile } from '#model/format/scene';

import {
  addUniqueCardListText,
  normalizeCardListText,
  shouldProposeCardCollect,
} from '#model/domain/cardCollect';
import {
  cardCollectProposalId,
  type CardCollectProposal,
  type CardCollectProposalDraft,
} from '#model/shared/cardCollect';
import type { NoteDocument } from '#model/shared/noteAbsorb';

export interface NoteCardPlan {
  // A new card starts as its bare identity; an existing card is the one on disk. Either way the
  // note's facts are the `changes` laid over it.
  readonly card: StoryboardCard;
  readonly isNew: boolean;
  readonly changes: readonly CardCollectProposal[];
  readonly sourceNotes: readonly string[];
  // How many readings of the notes gave each alias, keyed by its normalized text: when two cards
  // share an alias, this is what the consolidation request weighs it by.
  readonly aliasReadCounts: Readonly<Record<string, number>>;
}

export interface NoteScenePlan {
  readonly fileName: string;
  readonly card: SceneCard;
  readonly sourceNote?: string;
}

export interface NoteLeftOut {
  readonly label: string;
  readonly reason: string;
}

export interface UnclassifiedNote {
  readonly id: string;
  readonly title: string;
}

export interface NoteAbsorbPlan {
  readonly cards: readonly NoteCardPlan[];
  readonly scenes: readonly NoteScenePlan[];
  readonly skippedScenes: readonly NoteLeftOut[];
  readonly setting: NoteSynthesisSetting;
  readonly synopsis?: OutlineSynopsis;
  // Notes nothing was taken from. They are reported, never written anywhere.
  readonly unclassifiedNotes: readonly UnclassifiedNote[];
  // Prose already written: read for cards and premise, never turned into scenes.
  readonly draftNotes: readonly UnclassifiedNote[];
  readonly warnings: readonly string[];
}

export interface NoteAbsorbPlanInput {
  readonly notes: readonly NoteDocument[];
  // One per extraction request, in the order the notes were read.
  readonly extractions: readonly NoteExtraction[];
  readonly synthesis: NoteSynthesis;
  readonly cards: readonly StoryboardCard[];
  readonly scenes: readonly SceneFile[];
  readonly scenePrefixDigits: number;
}

const slugPattern = /^[a-z0-9][a-z0-9-]*$/;
const roleRank = { main: 3, supporting: 2, extra: 1 } as const;

function normalizeName(value: string): string {
  return value.normalize('NFC').trim().toLocaleLowerCase('ko').replace(/\s+/g, ' ');
}

function slugify(value: string): string | undefined {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slugPattern.test(slug) ? slug : undefined;
}

function union(left: readonly string[], right: readonly string[]): string[] {
  return [...new Set([...left, ...right])];
}

function unionText(left: readonly string[], right: readonly string[]): string[] {
  return [...left, ...right].reduce<string[]>(addUniqueCardListText, []);
}

function entityKind(card: StoryboardCard): NoteExtractionEntity['type'] {
  return card.type === 'character' ? 'character' : 'background';
}

// The same person described in two notes is one card. Lists are joined, and where two notes
// disagree on a keyed fact the note read first keeps its say.
function mergeEntity(
  first: NoteExtractionEntity,
  second: NoteExtractionEntity,
): NoteExtractionEntity {
  const firstRank = first.role === undefined ? 0 : roleRank[first.role];
  const secondRank = second.role === undefined ? 0 : roleRank[second.role];
  const knownAttributeKeys = new Set(first.attributes.map((attribute) => attribute.key));
  const knownRelationTargets = new Set(
    first.relations.map((relation) => normalizeName(relation.target)),
  );
  const otherNames = normalizeName(second.name) === normalizeName(first.name) ? [] : [second.name];

  return {
    type: first.type,
    name: first.name,
    suggestedId: first.suggestedId ?? second.suggestedId,
    existingId: first.existingId ?? second.existingId,
    role: secondRank > firstRank ? second.role : first.role,
    aliases: unionText(first.aliases, [...otherNames, ...second.aliases]),
    tags: unionText(first.tags, second.tags),
    traits: unionText(first.traits, second.traits),
    description: unionText(first.description, second.description),
    voice: unionText(first.voice, second.voice),
    desire: unionText(first.desire, second.desire),
    attributes: [
      ...first.attributes,
      ...second.attributes.filter((attribute) => !knownAttributeKeys.has(attribute.key)),
    ],
    relations: [
      ...first.relations,
      ...second.relations.filter(
        (relation) => !knownRelationTargets.has(normalizeName(relation.target)),
      ),
    ],
    senses: unionText(first.senses, second.senses),
    time: first.time ?? second.time,
    weather: first.weather ?? second.weather,
    characterNames: union(first.characterNames, second.characterNames),
    sourceNotes: union(first.sourceNotes, second.sourceNotes),
  };
}

function validCardId(value: string | undefined): string | undefined {
  return value !== undefined && cardIdPattern.test(value) ? value : undefined;
}

// The id an entity read in an earlier request goes by until the plan gives it one, so a later
// request can point at it the way it points at a card on disk.
function provisionalCardId(entity: NoteExtractionEntity): string | undefined {
  return validCardId(entity.suggestedId) ?? slugify(entity.name);
}

function idsOf(entity: NoteExtractionEntity): string[] {
  return [entity.existingId, provisionalCardId(entity)].filter(
    (id): id is string => id !== undefined,
  );
}

function namesOf(entity: NoteExtractionEntity): string[] {
  return [entity.name, ...entity.aliases].map(normalizeName);
}

function hasOwnId(entity: NoteExtractionEntity): boolean {
  return entity.existingId !== undefined || validCardId(entity.suggestedId) !== undefined;
}

// A name beats an id the model gave; aliases wait until every request has been read.
function findSameSubject(
  merged: readonly NoteExtractionEntity[],
  entity: NoteExtractionEntity,
): number | undefined {
  const sameType = [...merged.keys()].filter((index) => merged[index]?.type === entity.type);
  const name = normalizeName(entity.name);
  const byName = sameType.find((index) => normalizeName(merged[index]?.name ?? '') === name);

  if (byName !== undefined) {
    return byName;
  }

  const ids = idsOf(entity);

  return sameType.find((index) => {
    const known = merged[index];
    return known !== undefined && idsOf(known).some((id) => ids.includes(id));
  });
}

// An alias decides only when one entry's own name is the alias of exactly one other entry and
// the named entry has no id of its own. Two people who merely share an alias stay apart: a wrong
// merge mixes two people into one card, a wrong split is fixed by hand.
function findAliasTarget(
  groups: readonly NoteExtractionEntity[],
  index: number,
): number | undefined {
  const entity = groups[index];

  if (entity === undefined || hasOwnId(entity)) {
    return undefined;
  }

  const name = normalizeName(entity.name);
  const carriers = [...groups.keys()].filter((other) => {
    const known = groups[other];
    return other !== index && known?.type === entity.type && namesOf(known).includes(name);
  });

  return carriers.length === 1 ? carriers[0] : undefined;
}

function findRoot(parents: number[], index: number): number {
  let root = index;

  while (parents[root] !== root) {
    root = parents[root] as number;
  }

  return root;
}

interface MergedEntity {
  readonly entity: NoteExtractionEntity;
  // The entries the model returned that became this one, one per reading.
  readonly readings: readonly NoteExtractionEntity[];
}

function mergeEntities(entities: readonly NoteExtractionEntity[]): MergedEntity[] {
  const groups: NoteExtractionEntity[] = [];
  const readingsByGroup: NoteExtractionEntity[][] = [];

  for (const entity of entities) {
    const index = findSameSubject(groups, entity);
    const known = index === undefined ? undefined : groups[index];

    if (index === undefined || known === undefined) {
      groups.push(entity);
      readingsByGroup.push([entity]);
    } else {
      groups[index] = mergeEntity(known, entity);
      readingsByGroup[index]?.push(entity);
    }
  }

  const parents = [...groups.keys()];

  for (const index of groups.keys()) {
    const target = findAliasTarget(groups, index);

    if (target !== undefined) {
      const [first, second] = [findRoot(parents, index), findRoot(parents, target)].sort(
        (left, right) => left - right,
      );
      parents[second as number] = first as number;
    }
  }

  const merged = new Map<number, MergedEntity>();

  groups.forEach((entity, index) => {
    const root = findRoot(parents, index);
    const known = merged.get(root);
    const readings = readingsByGroup[index] ?? [];
    merged.set(
      root,
      known === undefined
        ? { entity, readings }
        : { entity: mergeEntity(known.entity, entity), readings: [...known.readings, ...readings] },
    );
  });

  return [...merged.values()];
}

function countAliasReads(readings: readonly NoteExtractionEntity[]): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const reading of readings) {
    for (const key of new Set(reading.aliases.map(normalizeCardListText))) {
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }

  return counts;
}

// What the requests read so far found, listed for the next request beside the cards on disk, so
// it points at the same person or place instead of naming it a second time.
export function listKnownNoteEntities(
  extractions: readonly NoteExtraction[],
  cards: readonly NoteExtractionKnownCard[],
): NoteExtractionKnownCard[] {
  const takenIds = new Set(cards.map((card) => card.id));
  const provisional = mergeEntities(extractions.flatMap((extraction) => extraction.entities))
    .map((merged) => merged.entity)
    .filter((entity) => entity.existingId === undefined)
    .flatMap((entity): NoteExtractionKnownCard[] => {
      const id = provisionalCardId(entity);

      if (id === undefined || takenIds.has(id)) {
        return [];
      }

      takenIds.add(id);

      return [{ id, type: entity.type, name: entity.name, aliases: entity.aliases }];
    });

  return [...cards, ...provisional];
}

function takeUniqueId(
  candidates: readonly (string | undefined)[],
  fallbackPrefix: string,
  takenIds: Set<string>,
): string {
  const base = candidates.find((candidate) => candidate !== undefined) ?? fallbackPrefix;
  let id = base;

  for (let suffix = 2; takenIds.has(id); suffix += 1) {
    id = `${base}-${suffix}`;
  }

  takenIds.add(id);

  return id;
}

function createNewCard(entity: NoteExtractionEntity, id: string): StoryboardCard {
  if (entity.type === 'character') {
    return { type: 'character', id, name: entity.name, role: entity.role ?? 'extra' };
  }

  return {
    type: 'location',
    id,
    name: entity.name,
    locationKind: 'place',
    description: [],
    characterIds: [],
    tags: [],
  };
}

interface ResolvedEntity {
  readonly entity: NoteExtractionEntity;
  readonly readings: readonly NoteExtractionEntity[];
  readonly card: StoryboardCard;
  readonly isNew: boolean;
}

// Names resolve to ids across what is already in the workspace and what this plan adds, so a
// relation between two people who both arrive from the notes still lands. A card's own name wins
// over another card's alias, and an alias two cards share resolves to neither.
class CardNameIndex {
  private readonly idsByName = new Map<string, string>();
  private readonly idsByAlias = new Map<string, Set<string>>();

  public constructor(private readonly kind: NoteExtractionEntity['type']) {}

  public add(card: StoryboardCard, extraAliases: readonly string[] = []): void {
    if (entityKind(card) !== this.kind) {
      return;
    }

    const nameKey = normalizeName(card.name);

    if (!this.idsByName.has(nameKey)) {
      this.idsByName.set(nameKey, card.id);
    }

    for (const alias of [...(card.aliases ?? []), ...extraAliases]) {
      const key = normalizeName(alias);
      this.idsByAlias.set(key, new Set([...(this.idsByAlias.get(key) ?? []), card.id]));
    }
  }

  public resolve(name: string): string | undefined {
    const key = normalizeName(name);
    const aliasIds = [...(this.idsByAlias.get(key) ?? [])];

    return this.idsByName.get(key) ?? (aliasIds.length === 1 ? aliasIds[0] : undefined);
  }
}

function toProposalDrafts(
  resolved: ResolvedEntity,
  characters: CardNameIndex,
): CardCollectProposalDraft[] {
  const { entity, card } = resolved;
  const drafts: CardCollectProposalDraft[] = [
    ...entity.aliases.map((value) => ({ kind: 'alias' as const, value })),
    ...entity.tags.map((value) => ({ kind: 'tag' as const, value })),
    ...entity.description.map((value) => ({ kind: 'descriptionLine' as const, value })),
  ];

  if (card.type === 'character') {
    drafts.push(
      ...entity.attributes.map(({ key, value }) => ({ kind: 'attribute' as const, key, value })),
      ...entity.traits.map((value) => ({ kind: 'trait' as const, value })),
      ...entity.voice.map((value) => ({ kind: 'voiceLine' as const, value })),
      ...entity.desire.map((value) => ({ kind: 'desireLine' as const, value })),
    );

    for (const relation of entity.relations) {
      const target = characters.resolve(relation.target);

      if (target !== undefined && target !== card.id) {
        drafts.push({ kind: 'relation', target, type: relation.type });
      }
    }

    return drafts;
  }

  drafts.push(...entity.senses.map((value) => ({ kind: 'sense' as const, value })));

  if (entity.time !== undefined) {
    drafts.push({ kind: 'scalar', field: 'time', after: entity.time });
  }

  if (entity.weather !== undefined) {
    drafts.push({ kind: 'scalar', field: 'weather', after: entity.weather });
  }

  for (const name of entity.characterNames) {
    const id = characters.resolve(name);

    if (id !== undefined) {
      drafts.push({ kind: 'characterId', value: id });
    }
  }

  return drafts;
}

function planCards(
  entities: readonly MergedEntity[],
  cards: readonly StoryboardCard[],
): {
  readonly plans: NoteCardPlan[];
  readonly characters: CardNameIndex;
  readonly backgrounds: CardNameIndex;
} {
  const characters = new CardNameIndex('character');
  const backgrounds = new CardNameIndex('background');
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const takenIds = new Set(cardsById.keys());

  for (const card of cards) {
    characters.add(card);
    backgrounds.add(card);
  }

  const resolved = entities.map(({ entity, readings }, index): ResolvedEntity => {
    const kindIndex = entity.type === 'character' ? characters : backgrounds;
    const byId = entity.existingId === undefined ? undefined : cardsById.get(entity.existingId);
    const existing =
      byId !== undefined && entityKind(byId) === entity.type
        ? byId
        : cardsById.get(kindIndex.resolve(entity.name) ?? '');

    if (existing !== undefined) {
      return { entity, readings, card: existing, isNew: false };
    }

    const id = takeUniqueId(
      [validCardId(entity.suggestedId), slugify(entity.name)],
      `${entity.type}-${index + 1}`,
      takenIds,
    );
    const card = createNewCard(entity, id);
    kindIndex.add(card, entity.aliases);

    return { entity, readings, card, isNew: true };
  });

  const plans = resolved.flatMap((entry): NoteCardPlan[] => {
    const changes = toProposalDrafts(entry, characters)
      .map(
        (draft) =>
          ({
            ...draft,
            id: cardCollectProposalId(draft),
            sourceScenes: entry.entity.sourceNotes,
          }) as CardCollectProposal,
      )
      .filter((proposal) => entry.isNew || shouldProposeCardCollect(entry.card, proposal));

    // An existing card the notes add nothing to is not a candidate.
    return entry.isNew || changes.length > 0
      ? [
          {
            card: entry.card,
            isNew: entry.isNew,
            changes,
            sourceNotes: entry.entity.sourceNotes,
            aliasReadCounts: countAliasReads(entry.readings),
          },
        ]
      : [];
  });

  return { plans, characters, backgrounds };
}

function findDraftNoteIds(extractions: readonly NoteExtraction[]): Set<string> {
  return new Set(
    extractions.flatMap((extraction) =>
      extraction.notes
        .filter((note) => note.kinds.some((kind) => kind === 'draft'))
        .map((note) => note.id),
    ),
  );
}

function beatsOf(scene: NoteExtractionScene): string[] {
  return scene.beats.length > 0 ? scene.beats : [scene.summary];
}

// One note is one scene. A model that splits a note anyway, or a note long enough to be read in two
// requests, gives several scenes for one source; they become the first one with every part a beat.
function mergeScenesBySourceNote(scenes: readonly NoteExtractionScene[]): NoteExtractionScene[] {
  const merged: NoteExtractionScene[] = [];
  const indexBySourceNote = new Map<string, number>();

  for (const scene of scenes) {
    const index =
      scene.sourceNote === undefined ? undefined : indexBySourceNote.get(scene.sourceNote);
    const known = index === undefined ? undefined : merged[index];

    if (index === undefined || known === undefined) {
      if (scene.sourceNote !== undefined) {
        indexBySourceNote.set(scene.sourceNote, merged.length);
      }

      merged.push(scene);
      continue;
    }

    merged[index] = {
      ...known,
      beats: [...beatsOf(known), ...beatsOf(scene)],
      characterNames: union(known.characterNames, scene.characterNames),
    };
  }

  return merged;
}

// A notebook has no scene numbers. The only order it has is the order its notes were read in, and
// within one note the order the scenes were written in — nothing here reorders by content.
function orderScenes(
  extractions: readonly NoteExtraction[],
  notes: readonly NoteDocument[],
): NoteExtractionScene[] {
  const noteIndexById = new Map(notes.map((note, index) => [note.id, index]));
  const draftNoteIds = findDraftNoteIds(extractions);
  const scenes = extractions
    .flatMap((extraction) => extraction.scenes)
    .filter((scene) => scene.sourceNote === undefined || !draftNoteIds.has(scene.sourceNote));

  return mergeScenesBySourceNote(scenes)
    .map((scene, position) => ({
      scene,
      position,
      noteIndex: noteIndexById.get(scene.sourceNote ?? '') ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort((left, right) => left.noteIndex - right.noteIndex || left.position - right.position)
    .map((entry) => entry.scene);
}

function planScenes(
  input: NoteAbsorbPlanInput,
  characters: CardNameIndex,
  backgrounds: CardNameIndex,
): {
  readonly plans: NoteScenePlan[];
  readonly skipped: NoteLeftOut[];
  readonly warnings: string[];
} {
  const existingTitles = new Set(
    input.scenes.flatMap((scene) =>
      scene.card.title === undefined ? [] : [normalizeName(scene.card.title)],
    ),
  );
  const takenSlugs = new Set(input.scenes.map((scene) => scene.slug));
  const lastOrder = Math.max(0, ...input.scenes.map((scene) => scene.order));
  const plans: NoteScenePlan[] = [];
  const skipped: NoteLeftOut[] = [];
  const warnings: string[] = [];

  for (const scene of orderScenes(input.extractions, input.notes)) {
    const titleKey = normalizeName(scene.title);

    if (existingTitles.has(titleKey)) {
      skipped.push({ label: scene.title, reason: '같은 제목의 씬이 이미 있습니다' });
      continue;
    }

    existingTitles.add(titleKey);

    const slug = takeUniqueId(
      [scene.slug !== undefined && slugPattern.test(scene.slug) ? scene.slug : undefined],
      'scene',
      takenSlugs,
    );
    const stem = `${String(lastOrder + plans.length + 1).padStart(input.scenePrefixDigits, '0')}-${slug}`;
    const fileName = `${stem}.card`;

    if (!sceneFileNamePattern.test(fileName)) {
      skipped.push({ label: scene.title, reason: `만들 수 없는 씬 파일 이름: ${fileName}` });
      continue;
    }

    const characterIds: string[] = [];

    for (const name of scene.characterNames) {
      const id = characters.resolve(name);

      if (id === undefined) {
        warnings.push(`씬 「${scene.title}」의 인물 「${name}」은 카드가 없어 연결하지 않았습니다.`);
      } else if (!characterIds.includes(id)) {
        characterIds.push(id);
      }
    }

    const locationId =
      scene.locationName === undefined ? undefined : backgrounds.resolve(scene.locationName);

    if (scene.locationName !== undefined && locationId === undefined) {
      warnings.push(
        `씬 「${scene.title}」의 장소 「${scene.locationName}」은 카드가 없어 연결하지 않았습니다.`,
      );
    }

    plans.push({
      fileName,
      card: {
        type: 'scene',
        id: stem,
        title: scene.title,
        ...(characterIds.length > 0 ? { characters: characterIds } : {}),
        ...(locationId === undefined ? {} : { location: locationId }),
        ...(scene.mood === undefined ? {} : { mood: scene.mood }),
        ...(scene.purpose === undefined ? {} : { purpose: scene.purpose }),
        summary: scene.summary,
        ...(scene.beats.length > 0 ? { beats: scene.beats } : {}),
      },
      ...(scene.sourceNote === undefined ? {} : { sourceNote: scene.sourceNote }),
    });
  }

  return { plans, skipped, warnings };
}

function findUnclassifiedNotes(input: NoteAbsorbPlanInput): UnclassifiedNote[] {
  const usedNoteIds = new Set<string>();

  for (const extraction of input.extractions) {
    for (const note of extraction.notes) {
      if (note.kinds.some((kind) => kind !== 'other')) {
        usedNoteIds.add(note.id);
      }
    }

    for (const entity of extraction.entities) {
      entity.sourceNotes.forEach((id) => usedNoteIds.add(id));
    }

    for (const scene of extraction.scenes) {
      if (scene.sourceNote !== undefined) {
        usedNoteIds.add(scene.sourceNote);
      }
    }
  }

  return input.notes
    .filter((note) => !usedNoteIds.has(note.id))
    .map((note) => ({ id: note.id, title: note.title }));
}

function findDraftNotes(input: NoteAbsorbPlanInput): UnclassifiedNote[] {
  const draftNoteIds = findDraftNoteIds(input.extractions);

  return input.notes
    .filter((note) => draftNoteIds.has(note.id))
    .map((note) => ({ id: note.id, title: note.title }));
}

function toSynopsis(synthesis: NoteSynthesis): OutlineSynopsis | undefined {
  const { synopsis, setting } = synthesis;
  const hasContent =
    [synopsis.logline, synopsis.genrePromise, synopsis.ending, synopsis.theme, synopsis.tone].some(
      (value) => value !== undefined,
    ) ||
    synopsis.mainConflicts.length > 0 ||
    synopsis.styleRules.length > 0;

  return hasContent
    ? outlineSynopsisSchema.parse({
        ...synopsis,
        ...(setting.pov === undefined ? {} : { pov: setting.pov }),
      })
    : undefined;
}

// Everything the notes would become, decided without touching the workspace: which cards are new,
// which only add to a card that exists, which scenes follow the last one, and what was left out.
export function buildNoteAbsorbPlan(input: NoteAbsorbPlanInput): NoteAbsorbPlan {
  const entities = mergeEntities(input.extractions.flatMap((extraction) => extraction.entities));
  const cards = planCards(entities, input.cards);
  const scenes = planScenes(input, cards.characters, cards.backgrounds);
  const synopsis = toSynopsis(input.synthesis);

  return {
    cards: cards.plans,
    scenes: scenes.plans,
    skippedScenes: scenes.skipped,
    setting: input.synthesis.setting,
    ...(synopsis === undefined ? {} : { synopsis }),
    unclassifiedNotes: findUnclassifiedNotes(input),
    draftNotes: findDraftNotes(input),
    warnings: scenes.warnings,
  };
}
