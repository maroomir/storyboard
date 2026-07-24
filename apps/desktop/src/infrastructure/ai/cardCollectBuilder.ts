import { shouldProposeCardCollect } from '@/domain/cardCollect';
import type { BackgroundCard, CharacterCard, StoryboardCard } from '@storyboard/story-format';
import {
  cardCollectProposalId,
  type CardCollectProposal,
  type CardCollectProposalDraft,
} from '@/shared/cardCollect';
import type { EntityRef, StoryboardAIService, UsageAttribution } from '@storyboard/story-ai';
import { extractQuotedUtterancesForCharacter } from './traitsUpdater';
export interface CollectDraft {
  readonly sceneStem: string;
  readonly body: string;
}

export interface CollectRosterEntry {
  readonly id: string;
  readonly name: string;
}

export type CardCollectAiService = Pick<
  StoryboardAIService,
  | 'extractCardCandidatesByCharacter'
  | 'extractTraitsByCharacter'
  | 'extractBackgroundFactsFromDraft'
>;

export interface BuildCardCollectProposalsInput {
  readonly card: StoryboardCard;
  readonly drafts: readonly CollectDraft[];
  readonly aiService: CardCollectAiService;
  readonly characterRoster: readonly CollectRosterEntry[];
}

export function filterDraftsForCard(
  card: StoryboardCard,
  drafts: readonly CollectDraft[],
): CollectDraft[] {
  const needles = [card.name, ...(card.aliases ?? [])]
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return drafts.filter((draft) => needles.some((needle) => draft.body.includes(needle)));
}

type PartialProposal = CardCollectProposalDraft;

class ProposalAccumulator {
  private readonly byId = new Map<string, { partial: PartialProposal; scenes: Set<string> }>();

  public add(sceneStem: string, partial: PartialProposal): void {
    const id = cardCollectProposalId(partial);
    const existing = this.byId.get(id);

    if (existing) {
      existing.scenes.add(sceneStem);
      return;
    }

    this.byId.set(id, { partial, scenes: new Set([sceneStem]) });
  }

  public finalize(card: StoryboardCard): CardCollectProposal[] {
    const proposals: CardCollectProposal[] = [];

    for (const [id, { partial, scenes }] of this.byId) {
      const before = resolveBefore(card, partial);
      const proposal = {
        ...partial,
        id,
        sourceScenes: [...scenes],
        ...(before !== undefined ? { before } : {}),
      } as CardCollectProposal;

      if (shouldProposeCardCollect(card, proposal)) {
        proposals.push(proposal);
      }
    }

    return proposals;
  }
}

function resolveBefore(card: StoryboardCard, partial: PartialProposal): string | undefined {
  if (card.type === 'character') {
    if (partial.kind === 'attribute') {
      const current = card.attributes?.[partial.key];
      return current === undefined || current === null ? undefined : String(current);
    }
    if (partial.kind === 'relation') {
      return (card.relations ?? []).find((relation) => relation.target === partial.target)?.type;
    }
    if (partial.kind === 'arc') {
      return (card.arc ?? []).find((entry) => entry.sceneRef === partial.sceneRef)?.summary;
    }
    return undefined;
  }

  if (partial.kind === 'scalar') {
    return partial.field === 'time' ? card.time : card.weather;
  }

  return undefined;
}

function buildTargetResolver(
  roster: readonly CollectRosterEntry[],
): (rawTarget: string) => string | undefined {
  const idByName = new Map(roster.map((entry) => [entry.name, entry.id]));
  const ids = new Set(roster.map((entry) => entry.id));

  return (rawTarget) => {
    const target = rawTarget.trim();
    return ids.has(target) ? target : idByName.get(target);
  };
}

function attributionFor(primary: EntityRef, sceneStem: string): UsageAttribution {
  return { primary, participants: [{ kind: 'scene', id: sceneStem }] };
}

async function buildCharacterProposals(
  card: CharacterCard,
  drafts: readonly CollectDraft[],
  aiService: CardCollectAiService,
  roster: readonly CollectRosterEntry[],
): Promise<CardCollectProposal[]> {
  const resolveTarget = buildTargetResolver(roster);
  const accumulator = new ProposalAccumulator();
  const primary: EntityRef = { kind: 'character', id: card.id };
  const aliases = card.aliases ?? [];

  for (const draft of drafts) {
    const attribution = attributionFor(primary, draft.sceneStem);

    const extracted = await aiService.extractCardCandidatesByCharacter(draft.body, [card.name], {
      attribution,
      aliases,
    });
    const candidate = extracted[card.name];

    if (candidate) {
      for (const attribute of candidate.attributes) {
        accumulator.add(draft.sceneStem, {
          kind: 'attribute',
          key: attribute.key,
          value: attribute.value,
        });
      }
      for (const relation of candidate.relations) {
        const target = resolveTarget(relation.target);
        if (target && target !== card.id) {
          accumulator.add(draft.sceneStem, { kind: 'relation', target, type: relation.type });
        }
      }
      for (const line of candidate.description) {
        accumulator.add(draft.sceneStem, { kind: 'descriptionLine', value: line });
      }
      for (const line of candidate.voice) {
        accumulator.add(draft.sceneStem, { kind: 'voiceLine', value: line });
      }
      for (const line of candidate.desire) {
        accumulator.add(draft.sceneStem, { kind: 'desireLine', value: line });
      }
      if (candidate.arc?.summary) {
        accumulator.add(draft.sceneStem, {
          kind: 'arc',
          summary: candidate.arc.summary,
          sceneRef: draft.sceneStem,
        });
      }
    }

    const traits = await aiService.extractTraitsByCharacter(draft.body, [card.name], {
      attribution,
      aliases,
    });
    for (const trait of traits[card.name] ?? []) {
      accumulator.add(draft.sceneStem, { kind: 'trait', value: trait });
    }

    for (const utterance of extractQuotedUtterancesForCharacter(draft.body, card.name, aliases)) {
      accumulator.add(draft.sceneStem, { kind: 'recentDialogue', value: utterance });
    }
  }

  return accumulator.finalize(card);
}

async function buildBackgroundProposals(
  card: BackgroundCard,
  drafts: readonly CollectDraft[],
  aiService: CardCollectAiService,
  roster: readonly CollectRosterEntry[],
): Promise<CardCollectProposal[]> {
  const idByName = new Map(roster.map((entry) => [entry.name, entry.id]));
  const accumulator = new ProposalAccumulator();
  const primary: EntityRef = { kind: 'background', id: card.id };

  for (const draft of drafts) {
    const attribution = attributionFor(primary, draft.sceneStem);
    const facts = await aiService.extractBackgroundFactsFromDraft(draft.body, card.name, {
      attribution,
    });

    for (const line of facts.description) {
      accumulator.add(draft.sceneStem, { kind: 'descriptionLine', value: line });
    }
    for (const sense of facts.senses) {
      accumulator.add(draft.sceneStem, { kind: 'sense', value: sense });
    }
    if (facts.time) {
      accumulator.add(draft.sceneStem, { kind: 'scalar', field: 'time', after: facts.time });
    }
    if (facts.weather) {
      accumulator.add(draft.sceneStem, { kind: 'scalar', field: 'weather', after: facts.weather });
    }
    for (const name of facts.characterNames) {
      const id = idByName.get(name);
      if (id) {
        accumulator.add(draft.sceneStem, { kind: 'characterId', value: id });
      }
    }
  }

  return accumulator.finalize(card);
}

export async function buildCardCollectProposals(
  input: BuildCardCollectProposalsInput,
): Promise<CardCollectProposal[]> {
  const drafts = filterDraftsForCard(input.card, input.drafts);

  if (drafts.length === 0) {
    return [];
  }

  return input.card.type === 'character'
    ? buildCharacterProposals(input.card, drafts, input.aiService, input.characterRoster)
    : buildBackgroundProposals(input.card, drafts, input.aiService, input.characterRoster);
}
