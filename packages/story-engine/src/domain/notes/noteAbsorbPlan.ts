import type {
  NoteExtraction,
  NoteExtractionEntity,
  NoteExtractionScene,
  NoteSynthesis,
  NoteSynthesisSetting,
} from '@storyboard/story-ai';
import {
  cardIdPattern,
  outlineSynopsisSchema,
  sceneFileNamePattern,
  type OutlineSynopsis,
  type SceneCard,
  type SceneFile,
  type StoryboardCard,
} from '@storyboard/story-model';

import { shouldProposeCardCollect } from '#engine/domain/cardCollect';
import {
  cardCollectProposalId,
  type CardCollectProposal,
  type CardCollectProposalDraft,
} from '#engine/shared/cardCollect';
import type { NoteDocument } from '#engine/shared/noteAbsorb';

export interface NoteCardPlan {
  // A new card starts as its bare identity; an existing card is the one on disk. Either way the
  // note's facts are the `changes` laid over it.
  readonly card: StoryboardCard;
  readonly isNew: boolean;
  readonly changes: readonly CardCollectProposal[];
  readonly sourceNotes: readonly string[];
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
    aliases: union(first.aliases, [...otherNames, ...second.aliases]),
    tags: union(first.tags, second.tags),
    traits: union(first.traits, second.traits),
    description: union(first.description, second.description),
    voice: union(first.voice, second.voice),
    desire: union(first.desire, second.desire),
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
    senses: union(first.senses, second.senses),
    time: first.time ?? second.time,
    weather: first.weather ?? second.weather,
    characterNames: union(first.characterNames, second.characterNames),
    sourceNotes: union(first.sourceNotes, second.sourceNotes),
  };
}

function mergeEntities(entities: readonly NoteExtractionEntity[]): NoteExtractionEntity[] {
  const merged: NoteExtractionEntity[] = [];

  for (const entity of entities) {
    const names = [entity.name, ...entity.aliases].map(normalizeName);
    const index = merged.findIndex(
      (known) =>
        known.type === entity.type &&
        [known.name, ...known.aliases].some((name) => names.includes(normalizeName(name))),
    );
    const known = merged[index];

    if (known === undefined) {
      merged.push(entity);
    } else {
      merged[index] = mergeEntity(known, entity);
    }
  }

  return merged;
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

function validCardId(value: string | undefined): string | undefined {
  return value !== undefined && cardIdPattern.test(value) ? value : undefined;
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
  readonly card: StoryboardCard;
  readonly isNew: boolean;
}

// Names resolve to ids across what is already in the workspace and what this plan adds, so a
// relation between two people who both arrive from the notes still lands.
class CardNameIndex {
  private readonly idsByName = new Map<string, string>();

  public constructor(private readonly kind: NoteExtractionEntity['type']) {}

  public add(card: StoryboardCard, extraNames: readonly string[] = []): void {
    if (entityKind(card) !== this.kind) {
      return;
    }

    for (const name of [card.name, ...(card.aliases ?? []), ...extraNames]) {
      const key = normalizeName(name);

      if (!this.idsByName.has(key)) {
        this.idsByName.set(key, card.id);
      }
    }
  }

  public resolve(name: string): string | undefined {
    return this.idsByName.get(normalizeName(name));
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
  entities: readonly NoteExtractionEntity[],
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

  const resolved = entities.map((entity, index): ResolvedEntity => {
    const kindIndex = entity.type === 'character' ? characters : backgrounds;
    const byId = entity.existingId === undefined ? undefined : cardsById.get(entity.existingId);
    const existing =
      byId !== undefined && entityKind(byId) === entity.type
        ? byId
        : cardsById.get(kindIndex.resolve(entity.name) ?? '');

    if (existing !== undefined) {
      return { entity, card: existing, isNew: false };
    }

    const id = takeUniqueId(
      [validCardId(entity.suggestedId), slugify(entity.name)],
      `${entity.type}-${index + 1}`,
      takenIds,
    );
    const card = createNewCard(entity, id);
    kindIndex.add(card, entity.aliases);

    return { entity, card, isNew: true };
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
      ? [{ card: entry.card, isNew: entry.isNew, changes, sourceNotes: entry.entity.sourceNotes }]
      : [];
  });

  return { plans, characters, backgrounds };
}

// A notebook has no scene numbers. The only order it has is the order its notes were read in, and
// within one note the order the scenes were written in — nothing here reorders by content.
function orderScenes(
  extractions: readonly NoteExtraction[],
  notes: readonly NoteDocument[],
): NoteExtractionScene[] {
  const noteIndexById = new Map(notes.map((note, index) => [note.id, index]));

  return extractions
    .flatMap((extraction) => extraction.scenes)
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
    warnings: scenes.warnings,
  };
}
