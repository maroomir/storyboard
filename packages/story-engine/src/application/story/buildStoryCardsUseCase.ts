import type { StoryUri } from '@storyboard/story-format';
import type { IUseCase } from '#engine/application/useCase';
import { z } from 'zod';

import type { AiGateway } from '#engine/application/ai/aiGateway';
import { applyCardCollectProposals, shouldProposeCardCollect } from '#engine/domain/cardCollect';
import type { SceneFile, StoryboardCard } from '@storyboard/story-format';
import { parseJsonObject } from '@storyboard/story-ai';
import {
  cardCollectProposalId,
  type CardCollectProposal,
  type CardCollectProposalDraft,
} from '#engine/shared/cardCollect';
import type { IStoryFeatureRepository, StoryFileSnapshot } from './storyFeatureTypes';
import { StoryFeatureSourceError } from './storyFeatureTypes';

const SCENE_CHUNK_SIZE = 40_000;
const MAX_PARALLEL_REQUESTS = 4;

// 모델은 "모르는 값"을 빈 문자열로 적어 보낸다. 그걸 오류로 세면 32씬을 다 읽고 온 응답이
// weather: "" 한 칸 때문에 통째로 버려진다. 빈 값은 안 적은 것으로 읽고, 목록에서는 걸러 낸다.
const optionalText = z.preprocess(
  (value) => (typeof value === 'string' && value.trim().length === 0 ? undefined : value),
  z.string().trim().min(1).optional(),
);

function textList() {
  return z.preprocess(
    (value) =>
      Array.isArray(value)
        ? value.filter((item) => typeof item !== 'string' || item.trim().length > 0)
        : value,
    z.array(z.string().trim().min(1)).default([]),
  );
}

const entitySchema = z.object({
  type: z.enum(['character', 'background']),
  name: z.string().trim().min(1),
  existingId: optionalText,
  role: z.enum(['main', 'supporting', 'extra']).optional(),
  aliases: textList(),
  tags: textList(),
  attributes: z
    .array(z.object({ key: z.string().trim().min(1), value: z.string().trim().min(1) }))
    .default([]),
  traits: textList(),
  description: textList(),
  voice: textList(),
  desire: textList(),
  relations: z
    .array(z.object({ target: z.string().trim().min(1), type: z.string().trim().min(1) }))
    .default([]),
  arc: z
    .array(
      z.object({
        stage: optionalText,
        summary: z.string().trim().min(1),
        sceneRef: optionalText,
      }),
    )
    .default([]),
  senses: textList(),
  time: optionalText,
  weather: optionalText,
  characterIds: textList(),
  sourceScenes: z.array(z.string().trim().min(1)).min(1),
});

const responseSchema = z.object({ entities: z.array(entitySchema) });
type StoryCardEntity = z.infer<typeof entitySchema>;

interface StoryCardChange {
  readonly proposal: CardCollectProposal;
  readonly label: string;
}

export interface StoryCardTarget {
  readonly card: StoryboardCard;
  readonly uriId: string;
  readonly isNew: boolean;
  readonly requiresIdConfirmation: boolean;
  readonly changes: readonly StoryCardChange[];
  readonly sourceScenes: readonly string[];
}

export interface BuildStoryCardsProposal {
  readonly targets: readonly StoryCardTarget[];
  readonly snapshots: readonly StoryFileSnapshot[];
}

export interface BuildStoryCardsUseCaseDependencies {
  readonly aiGateway: AiGateway;
  readonly repository: IStoryFeatureRepository;
}

export interface BuildStoryCardsRequest {
  readonly workspaceRoot: StoryUri;
}

export class BuildStoryCardsUseCase implements IUseCase<BuildStoryCardsRequest, BuildStoryCardsProposal> {
  public constructor(private readonly deps: BuildStoryCardsUseCaseDependencies) {}

  public async execute(request: BuildStoryCardsRequest): Promise<BuildStoryCardsProposal> {
    const { workspaceRoot } = request;
    const source = await this.deps.repository.load(workspaceRoot);
    if (source.scenes.length === 0) {
      throw new StoryFeatureSourceError('no-valid-scenes', '카드를 구성할 유효한 씬이 없습니다.');
    }

    const sceneStems = new Set(source.scenes.map((scene) => scene.stem));
    const chunks = groupScenes(source.scenes);
    const aiService = this.deps.aiGateway.createService(workspaceRoot);
    const responses = await mapWithConcurrency(chunks, MAX_PARALLEL_REQUESTS, async (chunk) => {
      const response = await aiService.generateText(
        'storyCardBuild',
        [
          {
            role: 'system',
            content:
              'Extract only facts explicitly supported by the supplied scenes. Return JSON only. Do not return paths. Existing cards are for identity matching and fact preservation, not evidence.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              task: 'Propose character and place/location cards or additive field enrichments.',
              existingCards: source.cards.map(cardIdentity),
              scenes: chunk.map(sceneForPrompt),
              constraints: {
                newCharacterRoles: ['main', 'supporting', 'extra'],
                uncertainRole: 'extra',
                newBackgroundType: 'location',
                newBackgroundLocationKind: 'place',
                noFactDeletion: true,
                sourceScenesMustBeFromThisChunk: true,
              },
              responseShape: { entities: [entityResponseShape()] },
            }),
          },
        ],
        {},
      );
      return responseSchema.parse(parseJsonObject(response.text)).entities;
    });
    const entities = responses.flat();
    const cardsById = new Map(source.cards.map((card) => [card.id, card]));
    const cardsByName = buildCardNameIndex(source.cards);
    const targets = new Map<string, StoryCardTarget>();

    for (const entity of entities) {
      validateSourceScenes(entity, sceneStems);
      const existing = findExistingCard(entity, cardsById, cardsByName);
      if (existing) {
        const changes = changesForExistingCard(existing, entity, cardsByName);
        if (changes.length > 0) {
          const current = targets.get(existing.id);
          targets.set(
            existing.id,
            mergeTarget(current, existing, false, changes, entity.sourceScenes),
          );
        }
        continue;
      }

      const newCard = buildNewCard(entity, cardsById, cardsByName, targets.size + 1);
      const current = targets.get(newCard.id);
      targets.set(
        newCard.id,
        mergeTarget(
          current,
          newCard,
          true,
          changesForNewCard(newCard, entity, cardsByName),
          entity.sourceScenes,
          newCard.id.startsWith('new-card-') || slugify(entity.name) === undefined,
        ),
      );
    }

    return {
      targets: [...targets.values()].sort((left, right) =>
        left.card.name.localeCompare(right.card.name, 'ko'),
      ),
      snapshots: source.snapshots,
    };
  }

  public async hasCurrentSources(snapshots: readonly StoryFileSnapshot[]): Promise<boolean> {
    return await this.deps.repository.hasCurrentSnapshots(snapshots);
  }
}

function entityResponseShape(): Record<string, unknown> {
  return {
    type: 'character | background',
    name: 'string',
    existingId: 'optional existing id',
    role: 'optional character role',
    aliases: ['string'],
    tags: ['string'],
    attributes: [{ key: 'string', value: 'string' }],
    traits: ['string'],
    description: ['string'],
    voice: ['string'],
    desire: ['string'],
    relations: [{ target: 'existing id or known name', type: 'string' }],
    arc: [{ stage: 'optional', summary: 'string', sceneRef: 'optional scene stem' }],
    senses: ['string'],
    time: 'optional',
    weather: 'optional',
    characterIds: ['existing character id or known name'],
    sourceScenes: ['NN-slug'],
  };
}

function sceneForPrompt(scene: SceneFile): Record<string, unknown> {
  return { stem: scene.stem, title: scene.frontmatter.title, body: scene.body };
}

function cardIdentity(card: StoryboardCard): Record<string, unknown> {
  return {
    id: card.id,
    type: card.type === 'character' ? 'character' : 'background',
    name: card.name,
    aliases: card.aliases ?? [],
  };
}

function groupScenes(scenes: readonly SceneFile[]): SceneFile[][] {
  const chunks: SceneFile[][] = [];
  let current: SceneFile[] = [];
  let size = 0;
  for (const scene of scenes) {
    const sceneSize = JSON.stringify(sceneForPrompt(scene)).length;
    if (current.length > 0 && size + sceneSize > SCENE_CHUNK_SIZE) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(scene);
    size += sceneSize;
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  maximum: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) {
        return;
      }
      results[index] = await mapper(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(maximum, items.length) }, worker));
  return results;
}

function buildCardNameIndex(cards: readonly StoryboardCard[]): Map<string, StoryboardCard> {
  const index = new Map<string, StoryboardCard>();
  for (const card of cards) {
    index.set(normalizeName(card.name), card);
    for (const alias of card.aliases ?? []) {
      index.set(normalizeName(alias), card);
    }
  }
  return index;
}

function findExistingCard(
  entity: StoryCardEntity,
  cardsById: ReadonlyMap<string, StoryboardCard>,
  cardsByName: ReadonlyMap<string, StoryboardCard>,
): StoryboardCard | undefined {
  const byId = entity.existingId ? cardsById.get(entity.existingId) : undefined;
  if (byId && matchesEntityType(byId, entity.type)) {
    return byId;
  }
  const byName = cardsByName.get(normalizeName(entity.name));
  return byName && matchesEntityType(byName, entity.type) ? byName : undefined;
}

function matchesEntityType(card: StoryboardCard, entityType: StoryCardEntity['type']): boolean {
  return entityType === 'character' ? card.type === 'character' : card.type !== 'character';
}

function buildNewCard(
  entity: StoryCardEntity,
  cardsById: ReadonlyMap<string, StoryboardCard>,
  cardsByName: ReadonlyMap<string, StoryboardCard>,
  sequence: number,
): StoryboardCard {
  if (cardsByName.has(normalizeName(entity.name))) {
    throw new StoryFeatureSourceError('card-name-conflict', `새 카드 이름이 기존 카드와 충돌합니다: ${entity.name}`);
  }
  const suggested = entity.existingId?.trim() ?? slugify(entity.name) ?? `new-card-${sequence}`;
  const id = cardsById.has(suggested) ? `new-card-${sequence}` : suggested;
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

function changesForExistingCard(
  card: StoryboardCard,
  entity: StoryCardEntity,
  cardsByName: ReadonlyMap<string, StoryboardCard>,
): StoryCardChange[] {
  return toChanges(card, entity, cardsByName).filter((change) =>
    shouldProposeCardCollect(card, change.proposal),
  );
}

function changesForNewCard(
  card: StoryboardCard,
  entity: StoryCardEntity,
  cardsByName: ReadonlyMap<string, StoryboardCard>,
): StoryCardChange[] {
  return toChanges(card, entity, cardsByName);
}

function toChanges(
  card: StoryboardCard,
  entity: StoryCardEntity,
  cardsByName: ReadonlyMap<string, StoryboardCard>,
): StoryCardChange[] {
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
      const target = resolveCardId(relation.target, cardsByName);
      if (target && target !== card.id) {
        drafts.push({ kind: 'relation', target, type: relation.type });
      }
    }
    for (const arc of entity.arc) {
      drafts.push({
        kind: 'arc',
        stage: arc.stage,
        summary: arc.summary,
        sceneRef: arc.sceneRef ?? entity.sourceScenes[0] ?? 'scene',
      });
    }
  } else {
    drafts.push(...entity.senses.map((value) => ({ kind: 'sense' as const, value })));
    if (entity.time) {
      drafts.push({ kind: 'scalar', field: 'time', after: entity.time });
    }
    if (entity.weather) {
      drafts.push({ kind: 'scalar', field: 'weather', after: entity.weather });
    }
    for (const value of entity.characterIds) {
      const id = resolveCardId(value, cardsByName);
      if (id) {
        drafts.push({ kind: 'characterId', value: id });
      }
    }
  }
  return drafts.map((draft) => {
    const proposal: CardCollectProposal = {
      ...draft,
      id: cardCollectProposalId(draft),
      sourceScenes: entity.sourceScenes,
    } as CardCollectProposal;
    return { proposal, label: changeLabel(proposal) };
  });
}

function mergeTarget(
  previous: StoryCardTarget | undefined,
  card: StoryboardCard,
  isNew: boolean,
  changes: readonly StoryCardChange[],
  sourceScenes: readonly string[],
  requiresIdConfirmation = false,
): StoryCardTarget {
  const combined = [...(previous?.changes ?? []), ...changes];
  const byId = new Map(combined.map((change) => [change.proposal.id, change]));
  return {
    card,
    uriId: card.id,
    isNew,
    requiresIdConfirmation: previous?.requiresIdConfirmation ?? requiresIdConfirmation,
    changes: [...byId.values()],
    sourceScenes: [...new Set([...(previous?.sourceScenes ?? []), ...sourceScenes])],
  };
}

function validateSourceScenes(entity: StoryCardEntity, sceneStems: ReadonlySet<string>): void {
  for (const stem of entity.sourceScenes) {
    if (!sceneStems.has(stem)) {
      throw new StoryFeatureSourceError('unknown-scene-reference', `카드 제안이 알 수 없는 근거 씬을 참조합니다: ${stem}`);
    }
  }
}

function resolveCardId(
  value: string,
  cardsByName: ReadonlyMap<string, StoryboardCard>,
): string | undefined {
  return (
    cardsByName.get(normalizeName(value))?.id ??
    (/^[a-z0-9][a-z0-9-]*$/.test(value) ? value : undefined)
  );
}

function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase('ko').replace(/\s+/g, ' ');
}

function slugify(value: string): string | undefined {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return /^[a-z0-9][a-z0-9-]*$/.test(slug) ? slug : undefined;
}

function changeLabel(proposal: CardCollectProposal): string {
  switch (proposal.kind) {
    case 'attribute':
      return `속성 · ${proposal.key}`;
    case 'relation':
      return `관계 · ${proposal.target}`;
    case 'arc':
      return `아크 · ${proposal.sceneRef}`;
    case 'scalar':
      return `${proposal.field} · ${proposal.after}`;
    case 'alias':
      return `별칭 · ${proposal.value}`;
    case 'tag':
      return `태그 · ${proposal.value}`;
    default:
      return `${proposal.kind} · ${proposal.value}`;
  }
}

export function applyStoryCardChanges(
  target: StoryCardTarget,
  selected: readonly CardCollectProposal[],
): StoryboardCard {
  return applyCardCollectProposals(target.card, selected);
}
