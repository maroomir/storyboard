import type {
  NoteAliasCarrier,
  NoteConsolidatedField,
  NoteConsolidatedLists,
  NoteConsolidationTarget,
  NoteSharedAlias,
} from '#model/contracts/noteConsolidation';
import type { StoryboardCard } from '#model/format/card';
import { normalizeCardListText } from '#model/domain/cardCollect';
import type { CardCollectProposal } from '#model/shared/cardCollect';

import type { NoteAbsorbPlan, NoteCardPlan } from './noteAbsorbPlan';

type CardKind = NoteConsolidationTarget['type'];
type ListKind = 'alias' | 'trait' | 'tag' | 'descriptionLine' | 'voiceLine' | 'desireLine' | 'sense';

const kindByField: Readonly<Record<NoteConsolidatedField, ListKind>> = {
  aliases: 'alias',
  traits: 'trait',
  tags: 'tag',
  description: 'descriptionLine',
  voice: 'voiceLine',
  desire: 'desireLine',
  senses: 'sense',
};

const fieldByKind = new Map(
  Object.entries(kindByField).map(([field, kind]) => [kind, field as NoteConsolidatedField]),
);

const fieldsByCardKind: Readonly<Record<CardKind, readonly NoteConsolidatedField[]>> = {
  character: ['aliases', 'traits', 'tags', 'description', 'voice', 'desire'],
  background: ['aliases', 'description', 'senses', 'tags'],
};

function cardKindOf(card: StoryboardCard): CardKind {
  return card.type === 'character' ? 'character' : 'background';
}

function existingValuesOf(card: StoryboardCard, field: NoteConsolidatedField): readonly string[] {
  const value = (card as Partial<Record<NoteConsolidatedField, unknown>>)[field];
  return Array.isArray(value) ? (value as string[]) : [];
}

function candidateValuesOf(plan: NoteCardPlan, field: NoteConsolidatedField): string[] {
  const kind = kindByField[field];
  return plan.changes.flatMap((change) =>
    change.kind === kind && 'value' in change ? [change.value] : [],
  );
}

function aliasKey(kind: CardKind, alias: string): string {
  return `${kind}:${normalizeCardListText(alias)}`;
}

// A form of address is a word or two; one with a space may be a remark about the name, which only
// the model can tell apart.
function isAliasWorthChecking(alias: string): boolean {
  return /\s/.test(alias);
}

function chunkCount(plan: NoteCardPlan, chunkByNoteId: ReadonlyMap<string, number>): number {
  return new Set(plan.sourceNotes.map((noteId) => chunkByNoteId.get(noteId))).size;
}

// Every card that carries each alias, on disk or as a candidate of this plan.
function collectAliasCarriers(
  plan: NoteAbsorbPlan,
  cards: readonly StoryboardCard[],
): Map<string, Map<string, NoteAliasCarrier>> {
  const carriersByAlias = new Map<string, Map<string, NoteAliasCarrier>>();
  const addCarrier = (card: StoryboardCard, alias: string): void => {
    const key = aliasKey(cardKindOf(card), alias);
    const carriers = carriersByAlias.get(key) ?? new Map<string, NoteAliasCarrier>();
    carriers.set(card.id, { cardId: card.id, name: card.name });
    carriersByAlias.set(key, carriers);
  };

  for (const card of cards) {
    existingValuesOf(card, 'aliases').forEach((alias) => addCarrier(card, alias));
  }

  for (const cardPlan of plan.cards) {
    candidateValuesOf(cardPlan, 'aliases').forEach((alias) => addCarrier(cardPlan.card, alias));
  }

  return carriersByAlias;
}

function findSharedAliases(
  cardPlan: NoteCardPlan,
  aliases: readonly string[],
  carriersByAlias: ReadonlyMap<string, ReadonlyMap<string, NoteAliasCarrier>>,
): NoteSharedAlias[] {
  return aliases.flatMap((alias): NoteSharedAlias[] => {
    const carriers = carriersByAlias.get(aliasKey(cardKindOf(cardPlan.card), alias));
    const otherCards = [...(carriers?.values() ?? [])].filter(
      (carrier) => carrier.cardId !== cardPlan.card.id,
    );

    return otherCards.length === 0 ? [] : [{ alias, otherCards }];
  });
}

// Lists joined from two readings repeat a meaning in other words, and so do new candidates beside
// what an existing card already says; exact matches are gone by now, so only the model can tell.
// An alias another card carries too, or one that reads like a remark, is asked about on any card.
export function selectNoteConsolidationTargets(
  plan: NoteAbsorbPlan,
  chunkByNoteId: ReadonlyMap<string, number>,
  cards: readonly StoryboardCard[],
): NoteConsolidationTarget[] {
  const carriersByAlias = collectAliasCarriers(plan, cards);

  return plan.cards.flatMap((cardPlan): NoteConsolidationTarget[] => {
    const { card } = cardPlan;
    const type = cardKindOf(card);
    const candidates: Partial<Record<NoteConsolidatedField, readonly string[]>> = {};
    const existing: Partial<Record<NoteConsolidatedField, readonly string[]>> = {};

    for (const field of fieldsByCardKind[type]) {
      const values = candidateValuesOf(cardPlan, field);
      const onCard = cardPlan.isNew ? [] : existingValuesOf(card, field);

      if (values.length > 0) {
        candidates[field] = values;

        if (onCard.length > 0) {
          existing[field] = onCard;
        }
      }
    }

    const aliases = candidates.aliases ?? [];
    const sharedAliases = findSharedAliases(cardPlan, aliases, carriersByAlias);
    const candidateCount = Object.values(candidates).reduce((total, list) => total + list.length, 0);
    const hasAliasToCheck = sharedAliases.length > 0 || aliases.some(isAliasWorthChecking);
    const hasRepeatsToCheck = cardPlan.isNew
      ? chunkCount(cardPlan, chunkByNoteId) > 1 && candidateCount > 1
      : Object.keys(existing).length > 0;

    return hasAliasToCheck || hasRepeatsToCheck
      ? [{ cardId: card.id, name: card.name, type, existing, candidates, sharedAliases }]
      : [];
  });
}

// NOTE: 정리 요청 하나가 받는 후보 분량(글자). 남기는 줄은 후보에서 고르므로 출력은 이 분량을 넘지
// 않는다. 한글 1.5자를 1토큰으로 보면 4천 토큰 남짓이라, 사고를 포함한 출력 한도(maxTokens 16000)
// 안에 든다. 2026-10 실측에서 성격·태그만으로도 출력 4천 토큰 한도에서 잘린 적이 있다.
export const noteConsolidationCharacterLimit = 6_000;

function measureTarget(target: NoteConsolidationTarget): number {
  const lists = [...Object.values(target.existing), ...Object.values(target.candidates)];

  return lists.flat().reduce((total, value) => total + value.length, target.name.length);
}

// Cards that share an alias are decided together, so they always travel in one request; past
// that, cards fill each request up to the limit in plan order. A group over the limit goes alone.
export function groupNoteConsolidationTargets(
  targets: readonly NoteConsolidationTarget[],
): NoteConsolidationTarget[][] {
  const indexById = new Map(targets.map((target, index) => [target.cardId, index]));
  const parents = targets.map((_, index) => index);
  const findRoot = (index: number): number => {
    let root = index;

    while (parents[root] !== root) {
      root = parents[root] as number;
    }

    return root;
  };

  targets.forEach((target, index) => {
    for (const shared of target.sharedAliases) {
      for (const carrier of shared.otherCards) {
        const other = indexById.get(carrier.cardId);

        if (other !== undefined) {
          const [first, second] = [findRoot(index), findRoot(other)].sort((a, b) => a - b);
          parents[second as number] = first as number;
        }
      }
    }
  });

  const linked = new Map<number, NoteConsolidationTarget[]>();

  targets.forEach((target, index) => {
    const root = findRoot(index);
    linked.set(root, [...(linked.get(root) ?? []), target]);
  });

  const requests: NoteConsolidationTarget[][] = [];
  let current: NoteConsolidationTarget[] = [];
  let currentSize = 0;

  for (const group of linked.values()) {
    const groupSize = group.reduce((total, target) => total + measureTarget(target), 0);

    if (current.length > 0 && currentSize + groupSize > noteConsolidationCharacterLimit) {
      requests.push(current);
      current = [];
      currentSize = 0;
    }

    current.push(...group);
    currentSize += groupSize;
  }

  if (current.length > 0) {
    requests.push(current);
  }

  return requests;
}

type KeptValues = Partial<Record<NoteConsolidatedField, Set<string>>>;

function keptValues(candidates: readonly string[], answer: readonly string[]): Set<string> {
  const answered = new Set(answer.map(normalizeCardListText));

  return new Set(candidates.filter((value) => answered.has(normalizeCardListText(value))));
}

// The model only chooses among the candidates: a value it rewrote or made up is not a candidate and
// is dropped, so the card keeps the notes' own wording. A field left out of the answer keeps every
// candidate, and so does a new card's list the answer empties — a description with no line at all
// cannot be right. Aliases may all go: every one of them may have been a remark or someone else's.
function narrowTargetValues(
  target: NoteConsolidationTarget,
  answer: NoteConsolidatedLists,
): KeptValues {
  const kept: KeptValues = {};

  for (const [field, candidates] of Object.entries(target.candidates) as [
    NoteConsolidatedField,
    readonly string[],
  ][]) {
    const answered = answer.values[field];

    if (answered === undefined) {
      continue;
    }

    const values = keptValues(candidates, answered);
    const isEmptiedList =
      values.size === 0 && field !== 'aliases' && target.existing[field] === undefined;

    if (!isEmptiedList) {
      kept[field] = values;
    }
  }

  return kept;
}

interface SharedAliasDecision {
  readonly alias: string;
  readonly proposers: readonly NoteConsolidationTarget[];
  // Cards that carry the alias without proposing it: they are on disk and are never changed.
  readonly onDisk: readonly NoteAliasCarrier[];
}

interface PendingSharedAlias {
  readonly alias: string;
  readonly proposers: NoteConsolidationTarget[];
  readonly carriers: Map<string, NoteAliasCarrier>;
}

function collectSharedAliasDecisions(
  targets: readonly NoteConsolidationTarget[],
): SharedAliasDecision[] {
  const decisions = new Map<string, PendingSharedAlias>();

  for (const target of targets) {
    for (const shared of target.sharedAliases) {
      const key = aliasKey(target.type, shared.alias);
      const decision: PendingSharedAlias = decisions.get(key) ?? {
        alias: shared.alias,
        proposers: [],
        carriers: new Map(),
      };
      decision.proposers.push(target);
      shared.otherCards.forEach((carrier) => decision.carriers.set(carrier.cardId, carrier));
      decisions.set(key, decision);
    }
  }

  return [...decisions.values()].map(({ alias, proposers, carriers }) => {
    const proposerIds = new Set(proposers.map((target) => target.cardId));
    const onDisk = [...carriers.values()].filter((carrier) => !proposerIds.has(carrier.cardId));

    return { alias, proposers, onDisk };
  });
}

function namesOf(carriers: readonly { readonly name: string }[]): string {
  return carriers.map((carrier) => carrier.name).join(', ');
}

// Whose a shared alias is gets decided across the cards that propose it. With no clear answer
// every card keeps it and the author is told; a card on disk is never changed.
function decideSharedAliases(
  targets: readonly NoteConsolidationTarget[],
  answerById: ReadonlyMap<string, NoteConsolidatedLists>,
  keptById: Map<string, KeptValues>,
): string[] {
  const warnings: string[] = [];

  for (const decision of collectSharedAliasDecisions(targets)) {
    const key = normalizeCardListText(decision.alias);
    const proposedValue = (target: NoteConsolidationTarget): string | undefined =>
      target.candidates.aliases?.find((alias) => normalizeCardListText(alias) === key);
    const isKeptBy = (target: NoteConsolidationTarget): boolean => {
      const value = proposedValue(target);
      return value !== undefined && (keptById.get(target.cardId)?.aliases?.has(value) ?? true);
    };
    const isUndecided = decision.proposers.some(
      (target) => answerById.get(target.cardId)?.values.aliases === undefined,
    );
    const keepers = decision.proposers.filter(isKeptBy);

    if (isUndecided || keepers.length > 1) {
      for (const target of decision.proposers) {
        const value = proposedValue(target);

        if (value !== undefined) {
          keptById.get(target.cardId)?.aliases?.add(value);
        }
      }

      const carriers = [...decision.proposers, ...decision.onDisk];
      warnings.push(
        `별칭 «${decision.alias}» 이 누구의 것인지 정하지 못해 ${namesOf(carriers)} 에 모두 남겼습니다.`,
      );
    } else if (keepers.length === 1 && decision.onDisk.length > 0) {
      warnings.push(
        `별칭 «${decision.alias}» 은 ${namesOf(keepers)} 의 것으로 보아 남겼습니다. 같은 별칭이 있는 기존 카드 ${namesOf(decision.onDisk)} 는 고치지 않았습니다.`,
      );
    }
  }

  return warnings;
}

function narrowCardPlan(cardPlan: NoteCardPlan, kept: KeptValues): NoteCardPlan {
  const isKept = (change: CardCollectProposal): boolean => {
    const field = fieldByKind.get(change.kind as ListKind);
    const values = field === undefined ? undefined : kept[field];

    return values === undefined || ('value' in change && values.has(change.value));
  };

  return { ...cardPlan, changes: cardPlan.changes.filter(isKept) };
}

export function applyNoteConsolidation(
  plan: NoteAbsorbPlan,
  targets: readonly NoteConsolidationTarget[],
  answers: readonly NoteConsolidatedLists[],
): { readonly plan: NoteAbsorbPlan; readonly warnings: readonly string[] } {
  const answerById = new Map(answers.map((answer) => [answer.cardId, answer]));
  const keptById = new Map<string, KeptValues>();

  for (const target of targets) {
    const answer = answerById.get(target.cardId);

    if (answer !== undefined) {
      keptById.set(target.cardId, narrowTargetValues(target, answer));
    }
  }

  const warnings = decideSharedAliases(targets, answerById, keptById);

  const cards = plan.cards.flatMap((cardPlan): NoteCardPlan[] => {
    const kept = keptById.get(cardPlan.card.id);

    if (kept === undefined) {
      return [cardPlan];
    }

    const narrowed = narrowCardPlan(cardPlan, kept);

    // An existing card the notes add nothing to is not a candidate.
    return narrowed.isNew || narrowed.changes.length > 0 ? [narrowed] : [];
  });

  return { plan: { ...plan, cards }, warnings };
}
