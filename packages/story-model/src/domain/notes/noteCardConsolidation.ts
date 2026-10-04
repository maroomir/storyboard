import type {
  NoteConsolidatedLists,
  NoteConsolidationTarget,
} from '#model/contracts/noteConsolidation';
import { normalizeCardListText } from '#model/domain/cardCollect';
import type { CardCollectProposal } from '#model/shared/cardCollect';

import type { NoteAbsorbPlan, NoteCardPlan } from './noteAbsorbPlan';

type ConsolidatedKind = 'trait' | 'tag';

function isConsolidatedKind(
  change: CardCollectProposal,
): change is Extract<CardCollectProposal, { kind: ConsolidatedKind }> {
  return change.kind === 'trait' || change.kind === 'tag';
}

function valuesOf(plan: NoteCardPlan, kind: ConsolidatedKind): string[] {
  return plan.changes.flatMap((change) => (change.kind === kind ? [change.value] : []));
}

function chunkCount(plan: NoteCardPlan, chunkByNoteId: ReadonlyMap<string, number>): number {
  return new Set(plan.sourceNotes.map((noteId) => chunkByNoteId.get(noteId))).size;
}

// Lists joined from two readings repeat a meaning in other words, and so do new candidates beside
// what an existing card already says; exact matches are gone by now, so only the model can tell.
export function selectNoteConsolidationTargets(
  plan: NoteAbsorbPlan,
  chunkByNoteId: ReadonlyMap<string, number>,
): NoteConsolidationTarget[] {
  return plan.cards.flatMap((cardPlan): NoteConsolidationTarget[] => {
    const { card } = cardPlan;

    if (card.type !== 'character') {
      return [];
    }

    const traits = valuesOf(cardPlan, 'trait');
    const tags = valuesOf(cardPlan, 'tag');
    const existingTraits = card.traits ?? [];
    const existingTags = card.tags ?? [];
    const isWorthAsking = cardPlan.isNew
      ? chunkCount(cardPlan, chunkByNoteId) > 1 && traits.length + tags.length > 1
      : existingTraits.length + existingTags.length > 0 && traits.length + tags.length > 0;

    return isWorthAsking
      ? [{ cardId: card.id, name: card.name, existingTraits, existingTags, traits, tags }]
      : [];
  });
}

function keptValues(candidates: readonly string[], answer: readonly string[]): Set<string> {
  const answered = new Set(answer.map(normalizeCardListText));

  return new Set(candidates.filter((value) => answered.has(normalizeCardListText(value))));
}

// The model only chooses among the candidates: a value it rewrote or made up is not a candidate and
// is dropped, so the card keeps the notes' own wording. A new person left with nothing is an answer
// that cannot be right, and keeps its candidates.
function narrowCardPlan(
  cardPlan: NoteCardPlan,
  target: NoteConsolidationTarget,
  answer: NoteConsolidatedLists,
): NoteCardPlan {
  const kept = {
    trait: keptValues(target.traits, answer.traits),
    tag: keptValues(target.tags, answer.tags),
  };

  if (cardPlan.isNew && kept.trait.size + kept.tag.size === 0) {
    return cardPlan;
  }

  return {
    ...cardPlan,
    changes: cardPlan.changes.filter(
      (change) => !isConsolidatedKind(change) || kept[change.kind].has(change.value),
    ),
  };
}

export function applyNoteConsolidation(
  plan: NoteAbsorbPlan,
  targets: readonly NoteConsolidationTarget[],
  answers: readonly NoteConsolidatedLists[],
): { readonly plan: NoteAbsorbPlan; readonly unanswered: readonly NoteConsolidationTarget[] } {
  const targetById = new Map(targets.map((target) => [target.cardId, target]));
  const answerById = new Map(answers.map((answer) => [answer.cardId, answer]));

  const cards = plan.cards.flatMap((cardPlan): NoteCardPlan[] => {
    const target = targetById.get(cardPlan.card.id);
    const answer = answerById.get(cardPlan.card.id);

    if (target === undefined || answer === undefined) {
      return [cardPlan];
    }

    const narrowed = narrowCardPlan(cardPlan, target, answer);

    // An existing card the notes add nothing to is not a candidate.
    return narrowed.isNew || narrowed.changes.length > 0 ? [narrowed] : [];
  });

  return {
    plan: { ...plan, cards },
    unanswered: targets.filter((target) => !answerById.has(target.cardId)),
  };
}
