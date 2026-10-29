import type {
  NoteExtraction,
  NoteExtractionEntity,
  NoteExtractionKnownCard,
  NoteExtractionScene,
} from '#model/contracts/noteExtraction';
import type { NoteSynthesis, NoteSynthesisSetting } from '#model/contracts/noteSynthesis';
import type { BibleFactSubject } from '#model/format/bible';
import { cardIdPattern, type CharacterRole, type StoryboardCard } from '#model/format/card';
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
import type { NoteDocument, SkippedNote } from '#model/shared/noteAbsorb';
import { slugify } from '#model/format/slug';
import { normalizeEntityName } from '#model/format/entityName';

export interface NoteCardPlan {
  readonly card: StoryboardCard;
  readonly isNew: boolean;
  readonly changes: readonly CardCollectProposal[];
  readonly sourceNotes: readonly string[];
  readonly aliasReadCounts: Readonly<Record<string, number>>;
}

export interface NoteScenePlan {
  readonly fileName: string;
  readonly card: SceneCard;
  readonly sourceNote?: string;
}

export interface UnclassifiedNote {
  readonly id: string;
  readonly title: string;
}

export interface NoteCanonCandidate {
  readonly subject: BibleFactSubject;
  readonly key: string;
  readonly value: string;
  readonly sourceNotes: readonly string[];
}

export interface NoteAbsorbPlan {
  readonly cards: readonly NoteCardPlan[];
  readonly scenes: readonly NoteScenePlan[];
  readonly skippedScenes: readonly SkippedNote[];
  readonly setting: NoteSynthesisSetting;
  readonly synopsis?: OutlineSynopsis;
  readonly unclassifiedNotes: readonly UnclassifiedNote[];
  readonly draftNotes: readonly UnclassifiedNote[];
  readonly voiceSeeds: Readonly<Record<string, readonly string[]>>;
  readonly canonCandidates: readonly NoteCanonCandidate[];
  readonly warnings: readonly string[];
}

export interface NoteAbsorbPlanInput {
  readonly notes: readonly NoteDocument[];
  readonly extractions: readonly NoteExtraction[];
  readonly synthesis: NoteSynthesis;
  readonly cards: readonly StoryboardCard[];
  readonly scenes: readonly SceneFile[];
  readonly scenePrefixDigits: number;
}

const slugPattern: RegExp = /^[a-z0-9][a-z0-9-]*$/;
const roleRank: Readonly<Record<CharacterRole, number>> = { main: 3, supporting: 2, extra: 1 };

function union(left: readonly string[], right: readonly string[]): string[] {
  return [...new Set([...left, ...right])];
}

function unionText(left: readonly string[], right: readonly string[]): string[] {
  return [...left, ...right].reduce<string[]>(addUniqueCardListText, []);
}

function entityKind(card: StoryboardCard): NoteExtractionEntity['type'] {
  return card.type === 'character' ? 'character' : 'background';
}

function mergeEntity(
  first: NoteExtractionEntity,
  second: NoteExtractionEntity,
): NoteExtractionEntity {
  const firstRank: number = first.role === undefined ? 0 : roleRank[first.role];
  const secondRank: number = second.role === undefined ? 0 : roleRank[second.role];
  const knownAttributeKeys: Set<string> = new Set(first.attributes.map((attribute) => attribute.key));
  const knownCanonKeys: Set<string> = new Set(first.canonFacts.map((fact) => fact.key));
  const knownRelationTargets: Set<string> = new Set(
    first.relations.map((relation) => normalizeEntityName(relation.target)),
  );
  const otherNames: string[] = normalizeEntityName(second.name) === normalizeEntityName(first.name) ? [] : [second.name];

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
    sampleLines: union(first.sampleLines, second.sampleLines),
    desire: unionText(first.desire, second.desire),
    attributes: [
      ...first.attributes,
      ...second.attributes.filter((attribute) => !knownAttributeKeys.has(attribute.key)),
    ],
    relations: [
      ...first.relations,
      ...second.relations.filter(
        (relation) => !knownRelationTargets.has(normalizeEntityName(relation.target)),
      ),
    ],
    canonFacts: [
      ...first.canonFacts,
      ...second.canonFacts.filter((fact) => !knownCanonKeys.has(fact.key)),
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

function provisionalCardId(entity: NoteExtractionEntity): string | undefined {
  return validCardId(entity.suggestedId) ?? slugify(entity.name);
}

function idsOf(entity: NoteExtractionEntity): string[] {
  return [entity.existingId, provisionalCardId(entity)].filter(
    (id): id is string => id !== undefined,
  );
}

function namesOf(entity: NoteExtractionEntity): string[] {
  return [entity.name, ...entity.aliases].map(normalizeEntityName);
}

function hasOwnId(entity: NoteExtractionEntity): boolean {
  return entity.existingId !== undefined || validCardId(entity.suggestedId) !== undefined;
}

function findSameSubject(
  merged: readonly NoteExtractionEntity[],
  entity: NoteExtractionEntity,
): number | undefined {
  const sameType: number[] = [...merged.keys()].filter((index) => merged[index]?.type === entity.type);
  const name: string = normalizeEntityName(entity.name);
  const byName: number | undefined = sameType.find((index) => normalizeEntityName(merged[index]?.name ?? '') === name);

  if (byName !== undefined) {
    return byName;
  }

  const ids: string[] = idsOf(entity);

  return sameType.find((index) => {
    const known: NoteExtractionEntity | undefined = merged[index];
    return known !== undefined && idsOf(known).some((id) => ids.includes(id));
  });
}

function findAliasTarget(
  groups: readonly NoteExtractionEntity[],
  index: number,
): number | undefined {
  const entity: NoteExtractionEntity | undefined = groups[index];

  if (entity === undefined || hasOwnId(entity)) {
    return undefined;
  }

  const name: string = normalizeEntityName(entity.name);
  const carriers: number[] = [...groups.keys()].filter((other) => {
    const known: NoteExtractionEntity | undefined = groups[other];
    return other !== index && known?.type === entity.type && namesOf(known).includes(name);
  });

  return carriers.length === 1 ? carriers[0] : undefined;
}

function findRoot(parents: number[], index: number): number {
  let root: number = index;

  while (parents[root] !== root) {
    root = parents[root] as number;
  }

  return root;
}

interface MergedEntity {
  readonly entity: NoteExtractionEntity;
  readonly readings: readonly NoteExtractionEntity[];
}

function mergeEntities(entities: readonly NoteExtractionEntity[]): MergedEntity[] {
  const groups: NoteExtractionEntity[] = [];
  const readingsByGroup: NoteExtractionEntity[][] = [];

  for (const entity of entities) {
    const index: number | undefined = findSameSubject(groups, entity);
    const known: NoteExtractionEntity | undefined = index === undefined ? undefined : groups[index];

    if (index === undefined || known === undefined) {
      groups.push(entity);
      readingsByGroup.push([entity]);
    } else {
      groups[index] = mergeEntity(known, entity);
      readingsByGroup[index]?.push(entity);
    }
  }

  const parents: number[] = [...groups.keys()];

  for (const index of groups.keys()) {
    const target: number | undefined = findAliasTarget(groups, index);

    if (target !== undefined) {
      const [first, second] = [findRoot(parents, index), findRoot(parents, target)].sort(
        (left, right) => left - right,
      );
      parents[second as number] = first as number;
    }
  }

  const merged: Map<number, MergedEntity> = new Map<number, MergedEntity>();

  groups.forEach((entity, index) => {
    const root: number = findRoot(parents, index);
    const known: MergedEntity | undefined = merged.get(root);
    const readings: NoteExtractionEntity[] = readingsByGroup[index] ?? [];
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

export function listKnownNoteEntities(
  extractions: readonly NoteExtraction[],
  cards: readonly NoteExtractionKnownCard[],
): NoteExtractionKnownCard[] {
  const takenIds: Set<string> = new Set(cards.map((card) => card.id));
  const provisional: NoteExtractionKnownCard[] = mergeEntities(extractions.flatMap((extraction) => extraction.entities))
    .map((merged) => merged.entity)
    .filter((entity) => entity.existingId === undefined)
    .flatMap((entity): NoteExtractionKnownCard[] => {
      const id: string | undefined = provisionalCardId(entity);

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
  const base: string = candidates.find((candidate) => candidate !== undefined) ?? fallbackPrefix;
  let id: string = base;

  for (let suffix: number = 2; takenIds.has(id); suffix += 1) {
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

class CardNameIndex {
  private readonly idsByName: Map<string, string> = new Map<string, string>();
  private readonly idsByAlias: Map<string, Set<string>> = new Map<string, Set<string>>();

  public constructor(private readonly kind: NoteExtractionEntity['type']) {}

  public add(card: StoryboardCard, extraAliases: readonly string[] = []): void {
    if (entityKind(card) !== this.kind) {
      return;
    }

    const nameKey: string = normalizeEntityName(card.name);

    if (!this.idsByName.has(nameKey)) {
      this.idsByName.set(nameKey, card.id);
    }

    for (const alias of [...(card.aliases ?? []), ...extraAliases]) {
      const key: string = normalizeEntityName(alias);
      this.idsByAlias.set(key, new Set([...(this.idsByAlias.get(key) ?? []), card.id]));
    }
  }

  public resolve(name: string): string | undefined {
    const key: string = normalizeEntityName(name);
    const aliasIds: string[] = [...(this.idsByAlias.get(key) ?? [])];

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
      const target: string | undefined = characters.resolve(relation.target);

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
    const id: string | undefined = characters.resolve(name);

    if (id !== undefined) {
      drafts.push({ kind: 'characterId', value: id });
    }
  }

  return drafts;
}

interface EntityResolutionContext {
  readonly characters: CardNameIndex;
  readonly backgrounds: CardNameIndex;
  readonly cardsById: ReadonlyMap<string, StoryboardCard>;
  readonly takenIds: Set<string>;
}

function findExistingCard(
  entity: NoteExtractionEntity,
  kindIndex: CardNameIndex,
  cardsById: ReadonlyMap<string, StoryboardCard>,
): StoryboardCard | undefined {
  const byId: StoryboardCard | undefined =
    entity.existingId === undefined ? undefined : cardsById.get(entity.existingId);

  return byId !== undefined && entityKind(byId) === entity.type
    ? byId
    : cardsById.get(kindIndex.resolve(entity.name) ?? '');
}

function resolveEntity(
  { entity, readings }: MergedEntity,
  index: number,
  context: EntityResolutionContext,
): ResolvedEntity {
  const kindIndex: CardNameIndex =
    entity.type === 'character' ? context.characters : context.backgrounds;
  const existing: StoryboardCard | undefined = findExistingCard(
    entity,
    kindIndex,
    context.cardsById,
  );

  if (existing !== undefined) {
    return { entity, readings, card: existing, isNew: false };
  }

  const id: string = takeUniqueId(
    [validCardId(entity.suggestedId), slugify(entity.name)],
    `${entity.type}-${index + 1}`,
    context.takenIds,
  );
  const card: StoryboardCard = createNewCard(entity, id);
  kindIndex.add(card, entity.aliases);

  return { entity, readings, card, isNew: true };
}

function toCardChanges(entry: ResolvedEntity, characters: CardNameIndex): CardCollectProposal[] {
  return toProposalDrafts(entry, characters)
    .map(
      (draft) =>
        ({
          ...draft,
          id: cardCollectProposalId(draft),
          sourceScenes: entry.entity.sourceNotes,
        }) as CardCollectProposal,
    )
    .filter((proposal) => entry.isNew || shouldProposeCardCollect(entry.card, proposal));
}

function planCardChanges(entry: ResolvedEntity, characters: CardNameIndex): NoteCardPlan[] {
  const changes: CardCollectProposal[] = toCardChanges(entry, characters);

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
}

function collectVoiceSeeds(resolved: readonly ResolvedEntity[]): Record<string, string[]> {
  return Object.fromEntries(
    resolved
      .filter((entry) => entry.entity.type === 'character' && entry.entity.sampleLines.length > 0)
      .map((entry) => [entry.card.id, entry.entity.sampleLines]),
  );
}

function collectCanonCandidates(resolved: readonly ResolvedEntity[]): NoteCanonCandidate[] {
  return resolved.flatMap((entry) =>
    entry.entity.canonFacts.map((fact) => ({
      subject: { kind: entry.entity.type, id: entry.card.id },
      key: fact.key,
      value: fact.value,
      sourceNotes: entry.entity.sourceNotes,
    })),
  );
}

function planCards(
  entities: readonly MergedEntity[],
  cards: readonly StoryboardCard[],
): {
  readonly plans: NoteCardPlan[];
  readonly characters: CardNameIndex;
  readonly backgrounds: CardNameIndex;
  readonly voiceSeeds: Readonly<Record<string, readonly string[]>>;
  readonly canonCandidates: NoteCanonCandidate[];
} {
  const characters: CardNameIndex = new CardNameIndex('character');
  const backgrounds: CardNameIndex = new CardNameIndex('background');
  const cardsById: Map<string, StoryboardCard> = new Map(cards.map((card) => [card.id, card]));
  const context: EntityResolutionContext = {
    characters,
    backgrounds,
    cardsById,
    takenIds: new Set(cardsById.keys()),
  };

  for (const card of cards) {
    characters.add(card);
    backgrounds.add(card);
  }

  const resolved: ResolvedEntity[] = entities.map(
    (entity, index): ResolvedEntity => resolveEntity(entity, index, context),
  );
  const plans: NoteCardPlan[] = resolved.flatMap((entry): NoteCardPlan[] =>
    planCardChanges(entry, characters),
  );

  return {
    plans,
    characters,
    backgrounds,
    voiceSeeds: collectVoiceSeeds(resolved),
    canonCandidates: collectCanonCandidates(resolved),
  };
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

function mergeScenesBySourceNote(scenes: readonly NoteExtractionScene[]): NoteExtractionScene[] {
  const merged: NoteExtractionScene[] = [];
  const indexBySourceNote: Map<string, number> = new Map<string, number>();

  for (const scene of scenes) {
    const index: number | undefined =
      scene.sourceNote === undefined ? undefined : indexBySourceNote.get(scene.sourceNote);
    const known: NoteExtractionScene | undefined = index === undefined ? undefined : merged[index];

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

function orderScenes(
  extractions: readonly NoteExtraction[],
  notes: readonly NoteDocument[],
): NoteExtractionScene[] {
  const noteIndexById: Map<string, number> = new Map(notes.map((note, index) => [note.id, index]));
  const draftNoteIds: Set<string> = findDraftNoteIds(extractions);
  const scenes: NoteExtractionScene[] = extractions
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

interface NoteScenePlanning {
  readonly plans: NoteScenePlan[];
  readonly skipped: SkippedNote[];
  readonly warnings: string[];
}

class NoteScenePlanner {
  private readonly existingTitles: Set<string>;
  private readonly takenSlugs: Set<string>;
  private readonly lastOrder: number;
  private readonly plans: NoteScenePlan[] = [];
  private readonly skipped: SkippedNote[] = [];
  private readonly warnings: string[] = [];

  public constructor(
    private readonly input: NoteAbsorbPlanInput,
    private readonly characters: CardNameIndex,
    private readonly backgrounds: CardNameIndex,
  ) {
    this.existingTitles = new Set(
      input.scenes.flatMap((scene) =>
        scene.card.title === undefined ? [] : [normalizeEntityName(scene.card.title)],
      ),
    );
    this.takenSlugs = new Set(input.scenes.map((scene) => scene.slug));
    this.lastOrder = Math.max(0, ...input.scenes.map((scene) => scene.order));
  }

  public addScene(scene: NoteExtractionScene): void {
    const titleKey: string = normalizeEntityName(scene.title);

    if (this.existingTitles.has(titleKey)) {
      this.skipped.push({ label: scene.title, reason: '같은 제목의 씬이 이미 있습니다' });
      return;
    }

    this.existingTitles.add(titleKey);

    const stem: string = this.takeSceneStem(scene);
    const fileName: string = `${stem}.card`;

    if (!sceneFileNamePattern.test(fileName)) {
      this.skipped.push({ label: scene.title, reason: `만들 수 없는 씬 파일 이름: ${fileName}` });
      return;
    }

    this.plans.push({
      fileName,
      card: this.createSceneCard(scene, stem),
      ...(scene.sourceNote === undefined ? {} : { sourceNote: scene.sourceNote }),
    });
  }

  public toPlanning(): NoteScenePlanning {
    return { plans: this.plans, skipped: this.skipped, warnings: this.warnings };
  }

  private takeSceneStem(scene: NoteExtractionScene): string {
    const slug: string = takeUniqueId(
      [scene.slug !== undefined && slugPattern.test(scene.slug) ? scene.slug : undefined],
      'scene',
      this.takenSlugs,
    );

    return `${String(this.lastOrder + this.plans.length + 1).padStart(this.input.scenePrefixDigits, '0')}-${slug}`;
  }

  private createSceneCard(scene: NoteExtractionScene, stem: string): SceneCard {
    const characterIds: string[] = this.resolveSceneCharacterIds(scene);
    const locationId: string | undefined = this.resolveSceneLocationId(scene);

    return {
      type: 'scene',
      id: stem,
      title: scene.title,
      ...(characterIds.length > 0 ? { characters: characterIds } : {}),
      ...(locationId === undefined ? {} : { location: locationId }),
      ...(scene.mood === undefined ? {} : { mood: scene.mood }),
      ...(scene.purpose === undefined ? {} : { purpose: scene.purpose }),
      summary: scene.summary,
      ...(scene.beats.length > 0 ? { beats: scene.beats } : {}),
    };
  }

  private resolveSceneCharacterIds(scene: NoteExtractionScene): string[] {
    const characterIds: string[] = [];

    for (const name of scene.characterNames) {
      const id: string | undefined = this.characters.resolve(name);

      if (id === undefined) {
        this.warnings.push(
          `씬 「${scene.title}」의 인물 「${name}」은 카드가 없어 연결하지 않았습니다.`,
        );
      } else if (!characterIds.includes(id)) {
        characterIds.push(id);
      }
    }

    return characterIds;
  }

  private resolveSceneLocationId(scene: NoteExtractionScene): string | undefined {
    const locationId: string | undefined =
      scene.locationName === undefined ? undefined : this.backgrounds.resolve(scene.locationName);

    if (scene.locationName !== undefined && locationId === undefined) {
      this.warnings.push(
        `씬 「${scene.title}」의 장소 「${scene.locationName}」은 카드가 없어 연결하지 않았습니다.`,
      );
    }

    return locationId;
  }
}

function planScenes(
  input: NoteAbsorbPlanInput,
  characters: CardNameIndex,
  backgrounds: CardNameIndex,
): NoteScenePlanning {
  const planner: NoteScenePlanner = new NoteScenePlanner(input, characters, backgrounds);

  for (const scene of orderScenes(input.extractions, input.notes)) {
    planner.addScene(scene);
  }

  return planner.toPlanning();
}

function findUnclassifiedNotes(input: NoteAbsorbPlanInput): UnclassifiedNote[] {
  const usedNoteIds: Set<string> = new Set<string>();

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
  const draftNoteIds: Set<string> = findDraftNoteIds(input.extractions);

  return input.notes
    .filter((note) => draftNoteIds.has(note.id))
    .map((note) => ({ id: note.id, title: note.title }));
}

function toSynopsis(synthesis: NoteSynthesis): OutlineSynopsis | undefined {
  const { synopsis, setting } = synthesis;
  const hasContent: boolean =
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

export function buildNoteAbsorbPlan(input: NoteAbsorbPlanInput): NoteAbsorbPlan {
  const entities: MergedEntity[] = mergeEntities(input.extractions.flatMap((extraction) => extraction.entities));
  const cards: ReturnType<typeof planCards> = planCards(entities, input.cards);
  const scenes: ReturnType<typeof planScenes> = planScenes(input, cards.characters, cards.backgrounds);
  const synopsis: OutlineSynopsis | undefined = toSynopsis(input.synthesis);

  return {
    cards: cards.plans,
    scenes: scenes.plans,
    skippedScenes: scenes.skipped,
    setting: input.synthesis.setting,
    ...(synopsis === undefined ? {} : { synopsis }),
    unclassifiedNotes: findUnclassifiedNotes(input),
    draftNotes: findDraftNotes(input),
    voiceSeeds: cards.voiceSeeds,
    canonCandidates: cards.canonCandidates,
    warnings: scenes.warnings,
  };
}
