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

// 경고는 작가가 읽으므로 칸 이름을 한국어로 쓰고, 카드 파일에서 찾을 수 있게 키를 괄호로 붙인다.
const labelByField: Readonly<Record<NoteConsolidatedField, string>> = {
  aliases: '다른 이름',
  traits: '성격',
  tags: '태그',
  description: '소개',
  voice: '말투',
  desire: '바라는 것',
  senses: '감각',
};

const fieldByKind: Map<ListKind, NoteConsolidatedField> = new Map(
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
  const value: unknown = (card as Partial<Record<NoteConsolidatedField, unknown>>)[field];
  return Array.isArray(value) ? (value as string[]) : [];
}

function candidateValuesOf(plan: NoteCardPlan, field: NoteConsolidatedField): string[] {
  const kind: ListKind = kindByField[field];
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

function readCountOf(cardPlan: NoteCardPlan, alias: string): number {
  return cardPlan.aliasReadCounts[normalizeCardListText(alias)] ?? 1;
}

// Every card that carries each alias, on disk or as a candidate of this plan.
function collectAliasCarriers(
  plan: NoteAbsorbPlan,
  cards: readonly StoryboardCard[],
): Map<string, Map<string, NoteAliasCarrier>> {
  const carriersByAlias: Map<string, Map<string, NoteAliasCarrier>> = new Map<string, Map<string, NoteAliasCarrier>>();
  const addCarrier = (card: StoryboardCard, alias: string, readCount?: number): void => {
    const key: string = aliasKey(cardKindOf(card), alias);
    const carriers: Map<string, NoteAliasCarrier> = carriersByAlias.get(key) ?? new Map<string, NoteAliasCarrier>();
    carriers.set(card.id, {
      cardId: card.id,
      name: card.name,
      ...(readCount === undefined ? {} : { readCount }),
    });
    carriersByAlias.set(key, carriers);
  };

  for (const card of cards) {
    existingValuesOf(card, 'aliases').forEach((alias) => addCarrier(card, alias));
  }

  for (const cardPlan of plan.cards) {
    candidateValuesOf(cardPlan, 'aliases').forEach((alias) =>
      addCarrier(cardPlan.card, alias, readCountOf(cardPlan, alias)),
    );
  }

  return carriersByAlias;
}

function findSharedAliases(
  cardPlan: NoteCardPlan,
  aliases: readonly string[],
  carriersByAlias: ReadonlyMap<string, ReadonlyMap<string, NoteAliasCarrier>>,
): NoteSharedAlias[] {
  return aliases.flatMap((alias): NoteSharedAlias[] => {
    const carriers: ReadonlyMap<string, NoteAliasCarrier> | undefined = carriersByAlias.get(aliasKey(cardKindOf(cardPlan.card), alias));
    const otherCards: NoteAliasCarrier[] = [...(carriers?.values() ?? [])].filter(
      (carrier) => carrier.cardId !== cardPlan.card.id,
    );

    return otherCards.length === 0
      ? []
      : [{ alias, readCount: readCountOf(cardPlan, alias), otherCards }];
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
  const carriersByAlias: Map<string, Map<string, NoteAliasCarrier>> = collectAliasCarriers(plan, cards);

  return plan.cards.flatMap((cardPlan): NoteConsolidationTarget[] => {
    const { card } = cardPlan;
    const type: CardKind = cardKindOf(card);
    const candidates: Partial<Record<NoteConsolidatedField, readonly string[]>> = {};
    const existing: Partial<Record<NoteConsolidatedField, readonly string[]>> = {};

    for (const field of fieldsByCardKind[type]) {
      const values: string[] = candidateValuesOf(cardPlan, field);
      const onCard: readonly string[] = cardPlan.isNew ? [] : existingValuesOf(card, field);

      if (values.length > 0) {
        candidates[field] = values;

        if (onCard.length > 0) {
          existing[field] = onCard;
        }
      }
    }

    const aliases: readonly string[] = candidates.aliases ?? [];
    const sharedAliases: NoteSharedAlias[] = findSharedAliases(cardPlan, aliases, carriersByAlias);
    const candidateCount: number = Object.values(candidates).reduce((total, list) => total + list.length, 0);
    const hasAliasToCheck: boolean = sharedAliases.length > 0 || aliases.some(isAliasWorthChecking);
    const hasRepeatsToCheck: boolean = cardPlan.isNew
      ? chunkCount(cardPlan, chunkByNoteId) > 1 && candidateCount > 1
      : Object.keys(existing).length > 0;

    return hasAliasToCheck || hasRepeatsToCheck
      ? [{ cardId: card.id, name: card.name, type, existing, candidates, sharedAliases }]
      : [];
  });
}

// Each card is its own request, so the model weighs one card's lines against each other instead of
// skimming a dozen cards at once; cards that share an alias are decided together, so they travel
// in one request.
export function groupNoteConsolidationTargets(
  targets: readonly NoteConsolidationTarget[],
): NoteConsolidationTarget[][] {
  const indexById: Map<string, number> = new Map(targets.map((target, index) => [target.cardId, index]));
  const parents: number[] = targets.map((_, index) => index);
  const findRoot = (index: number): number => {
    let root: number = index;

    while (parents[root] !== root) {
      root = parents[root] as number;
    }

    return root;
  };

  targets.forEach((target, index) => {
    for (const shared of target.sharedAliases) {
      for (const carrier of shared.otherCards) {
        const other: number | undefined = indexById.get(carrier.cardId);

        if (other !== undefined) {
          const [first, second] = [findRoot(index), findRoot(other)].sort((a, b) => a - b);
          parents[second as number] = first as number;
        }
      }
    }
  });

  const requests: Map<number, NoteConsolidationTarget[]> = new Map<number, NoteConsolidationTarget[]>();

  targets.forEach((target, index) => {
    const root: number = findRoot(index);
    requests.set(root, [...(requests.get(root) ?? []), target]);
  });

  return [...requests.values()];
}

type KeptValues = Partial<Record<NoteConsolidatedField, Set<string>>>;

function keptFromList(candidates: readonly string[], answer: readonly string[]): Set<string> {
  const answered: Set<string> = new Set(answer.map(normalizeCardListText));

  return new Set(candidates.filter((value) => answered.has(normalizeCardListText(value))));
}

// Each group keeps one line in the notes' own wording: its first item that is a candidate. A group
// headed by a line the card already has keeps none, since that meaning is on the card. A group with
// no candidate in it places nothing, so a candidate left out of every group is kept.
function keptFromGroups(
  target: NoteConsolidationTarget,
  field: NoteConsolidatedField,
  groups: readonly (readonly string[])[],
  warnings: string[],
): Set<string> {
  const candidateByKey: Map<string, string> = new Map(
    (target.candidates[field] ?? []).map((value) => [normalizeCardListText(value), value]),
  );
  const existingKeys: Set<string> = new Set((target.existing[field] ?? []).map(normalizeCardListText));
  const kept: Set<string> = new Set<string>();
  const placedKeys: Set<string> = new Set<string>();

  for (const group of groups) {
    const members: string[] = group.flatMap((item) => {
      const value: string | undefined = candidateByKey.get(normalizeCardListText(item));
      return value === undefined ? [] : [value];
    });
    const [head] = group;
    const [firstMember] = members;

    if (head === undefined || firstMember === undefined) {
      continue;
    }

    members.forEach((value) => placedKeys.add(normalizeCardListText(value)));

    if (existingKeys.has(normalizeCardListText(head))) {
      continue;
    }

    if (!candidateByKey.has(normalizeCardListText(head))) {
      warnings.push(
        `카드 ${target.name} 의 ${field} 정리 답이 후보에 없는 «${head}» 를 대표로 적어, 그 묶음에서 노트의 문구 «${firstMember}» 를 남겼습니다.`,
      );
    }

    kept.add(firstMember);
  }

  for (const [key, value] of candidateByKey) {
    if (!placedKeys.has(key)) {
      kept.add(value);
    }
  }

  return kept;
}

// The model only chooses among the candidates: a value it rewrote or made up never reaches the
// card, which keeps the notes' own wording. Every candidate of a field stays when the answer leaves
// the field out, answers a list other than aliases flat (that shape cannot say which line covers a
// dropped one), or empties a new card's list — a description with no line at all cannot be right.
// Aliases are answered as a flat list and may all go: each may have been a remark or someone else's.
function narrowTargetValues(
  target: NoteConsolidationTarget,
  answer: NoteConsolidatedLists,
  warnings: string[],
): KeptValues {
  const kept: KeptValues = {};

  for (const [field, candidates] of Object.entries(target.candidates) as [
    NoteConsolidatedField,
    readonly string[],
  ][]) {
    const groups: readonly (readonly string[])[] | undefined = answer.groups?.[field];
    const list: readonly string[] | undefined = answer.values[field];
    let values: Set<string>;

    if (groups !== undefined) {
      values = keptFromGroups(target, field, groups, warnings);
    } else if (list !== undefined && field === 'aliases') {
      values = keptFromList(candidates, list);
    } else {
      if (list !== undefined) {
        warnings.push(
          `카드 ${target.name} 의 ${field} 정리 답이 묶음 형식이 아니어서 후보를 모두 남겼습니다.`,
        );
      }

      continue;
    }

    const isEmptiedList: boolean =
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
  const decisions: Map<string, PendingSharedAlias> = new Map<string, PendingSharedAlias>();

  for (const target of targets) {
    for (const shared of target.sharedAliases) {
      const key: string = aliasKey(target.type, shared.alias);
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
    const proposerIds: Set<string> = new Set(proposers.map((target) => target.cardId));
    const onDisk: NoteAliasCarrier[] = [...carriers.values()].filter((carrier) => !proposerIds.has(carrier.cardId));

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
    const key: string = normalizeCardListText(decision.alias);
    const proposedValue = (target: NoteConsolidationTarget): string | undefined =>
      target.candidates.aliases?.find((alias) => normalizeCardListText(alias) === key);
    const isKeptBy = (target: NoteConsolidationTarget): boolean => {
      const value: string | undefined = proposedValue(target);
      return value !== undefined && (keptById.get(target.cardId)?.aliases?.has(value) ?? true);
    };
    const isUndecided: boolean = decision.proposers.some((target) => {
      const answer: NoteConsolidatedLists | undefined = answerById.get(target.cardId);
      return answer?.values.aliases === undefined && answer?.groups?.aliases === undefined;
    });
    const keepers: NoteConsolidationTarget[] = decision.proposers.filter(isKeptBy);

    if (isUndecided || keepers.length > 1) {
      for (const target of decision.proposers) {
        const value: string | undefined = proposedValue(target);

        if (value !== undefined) {
          keptById.get(target.cardId)?.aliases?.add(value);
        }
      }

      const carriers: (NoteAliasCarrier | NoteConsolidationTarget)[] = [...decision.proposers, ...decision.onDisk];
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
    const field: "tags" | "description" | "voice" | "aliases" | "traits" | "desire" | "senses" | undefined = fieldByKind.get(change.kind as ListKind);
    const values: Set<string> | undefined = field === undefined ? undefined : kept[field];

    return values === undefined || ('value' in change && values.has(change.value));
  };

  return { ...cardPlan, changes: cardPlan.changes.filter(isKept) };
}

// Both items stay on the card: a one-shot import has nobody to ask, so the author is told instead.
function describeConflicts(
  target: NoteConsolidationTarget,
  answer: NoteConsolidatedLists,
): string[] {
  return (answer.conflicts ?? []).map(
    (conflict) =>
      `${target.name} 의 ${labelByField[conflict.field]}(${conflict.field}) 후보가 서로 맞지 않습니다: ${conflict.items
        .map((item) => `«${item}»`)
        .join(' / ')}. 둘 다 남겼으니 카드를 확인해 하나를 지우세요.`,
  );
}

export function applyNoteConsolidation(
  plan: NoteAbsorbPlan,
  targets: readonly NoteConsolidationTarget[],
  answers: readonly NoteConsolidatedLists[],
): { readonly plan: NoteAbsorbPlan; readonly warnings: readonly string[] } {
  const answerById: Map<string, NoteConsolidatedLists> = new Map(answers.map((answer) => [answer.cardId, answer]));
  const keptById: Map<string, Partial<Record<NoteConsolidatedField, Set<string>>>> = new Map<string, KeptValues>();
  const warnings: string[] = [];

  for (const target of targets) {
    const answer: NoteConsolidatedLists | undefined = answerById.get(target.cardId);

    if (answer !== undefined) {
      keptById.set(target.cardId, narrowTargetValues(target, answer, warnings));
      warnings.push(...describeConflicts(target, answer));
    }
  }

  warnings.push(...decideSharedAliases(targets, answerById, keptById));

  const cards: NoteCardPlan[] = plan.cards.flatMap((cardPlan): NoteCardPlan[] => {
    const kept: Partial<Record<NoteConsolidatedField, Set<string>>> | undefined = keptById.get(cardPlan.card.id);

    if (kept === undefined) {
      return [cardPlan];
    }

    const narrowed: NoteCardPlan = narrowCardPlan(cardPlan, kept);

    // An existing card the notes add nothing to is not a candidate.
    return narrowed.isNew || narrowed.changes.length > 0 ? [narrowed] : [];
  });

  return { plan: { ...plan, cards }, warnings };
}
