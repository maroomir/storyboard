import {
  shouldProposeCardCollect,
  cardCollectProposalId,
  type CardCollectProposal,
  type CardCollectProposalDraft,
} from '@storyboard/story-model';
import type {
  BackgroundCard,
  CharacterCard,
  StoryboardCard,
  EntityRef,
  UsageAttribution,
  CharacterRef,
} from '@storyboard/story-model';
import type {
  BackgroundFactExtraction,
  CardCandidateExtraction,
  StoryboardAiService,
} from '@storyboard/story-ai';
import { extractQuotedUtterancesForCharacter } from '#engine/ai/traitsUpdater';
import { buildTargetResolver } from '#engine/ai/cardCandidateUpdater';

interface ProposalWithScenes {
  partial: PartialProposal;
  scenes: Set<string>;
}

export interface CollectDraft {
  readonly sceneStem: string;
  readonly body: string;
}

export type CardCollectAiService = Pick<
  StoryboardAiService,
  | 'extractCardCandidatesByCharacter'
  | 'extractTraitsByCharacter'
  | 'extractBackgroundFactsFromDraft'
>;

export interface BuildCardCollectProposalsInput {
  readonly card: StoryboardCard;
  readonly drafts: readonly CollectDraft[];
  readonly aiService: CardCollectAiService;
  readonly characterRoster: readonly CharacterRef[];
}

export function filterDraftsForCard(
  card: StoryboardCard,
  drafts: readonly CollectDraft[],
): CollectDraft[] {
  const needles: string[] = [card.name, ...(card.aliases ?? [])]
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return drafts.filter((draft) => needles.some((needle) => draft.body.includes(needle)));
}

type PartialProposal = CardCollectProposalDraft;

class ProposalAccumulator {
  private readonly byId: Map<string, ProposalWithScenes> = new Map<string, ProposalWithScenes>();

  public add(sceneStem: string, partial: PartialProposal): void {
    const id: string = cardCollectProposalId(partial);
    const existing: ProposalWithScenes | undefined = this.byId.get(id);

    if (existing) {
      existing.scenes.add(sceneStem);
      return;
    }

    this.byId.set(id, { partial, scenes: new Set([sceneStem]) });
  }

  public finalize(card: StoryboardCard): CardCollectProposal[] {
    const proposals: CardCollectProposal[] = [];

    for (const [id, { partial, scenes }] of this.byId) {
      const before: string | undefined = resolveBefore(card, partial);
      const proposal: CardCollectProposal = {
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
      const current: string | number | boolean | null | undefined = card.attributes?.[partial.key];
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

function attributionFor(primary: EntityRef, sceneStem: string): UsageAttribution {
  return { primary, participants: [{ kind: 'scene', id: sceneStem }] };
}

interface CharacterProposalContext {
  readonly card: CharacterCard;
  readonly aiService: CardCollectAiService;
  readonly aliases: string[];
  readonly primary: EntityRef;
  readonly resolveTarget: (rawTarget: string) => string | undefined;
  readonly accumulator: ProposalAccumulator;
}

function addCandidateProposals(
  context: CharacterProposalContext,
  sceneStem: string,
  candidate: CardCandidateExtraction,
): void {
  const { card, resolveTarget, accumulator } = context;

  for (const attribute of candidate.attributes) {
    accumulator.add(sceneStem, {
      kind: 'attribute',
      key: attribute.key,
      value: attribute.value,
    });
  }
  for (const relation of candidate.relations) {
    const target: string | undefined = resolveTarget(relation.target);
    if (target && target !== card.id) {
      accumulator.add(sceneStem, { kind: 'relation', target, type: relation.type });
    }
  }
  for (const line of candidate.description) {
    accumulator.add(sceneStem, { kind: 'descriptionLine', value: line });
  }
  for (const line of candidate.voice) {
    accumulator.add(sceneStem, { kind: 'voiceLine', value: line });
  }
  for (const line of candidate.desire) {
    accumulator.add(sceneStem, { kind: 'desireLine', value: line });
  }
  if (candidate.arc?.summary) {
    accumulator.add(sceneStem, {
      kind: 'arc',
      summary: candidate.arc.summary,
      sceneRef: sceneStem,
    });
  }
}

async function addDraftCharacterProposals(
  context: CharacterProposalContext,
  draft: CollectDraft,
): Promise<void> {
  const { card, aiService, aliases, primary, accumulator } = context;
  const attribution: UsageAttribution = attributionFor(primary, draft.sceneStem);

  const extracted: Record<string, CardCandidateExtraction> =
    await aiService.extractCardCandidatesByCharacter(draft.body, [card.name], {
      attribution,
      aliases,
    });
  const candidate: CardCandidateExtraction | undefined = extracted[card.name];

  if (candidate) {
    addCandidateProposals(context, draft.sceneStem, candidate);
  }

  const traits: Record<string, string[]> = await aiService.extractTraitsByCharacter(
    draft.body,
    [card.name],
    {
      attribution,
      aliases,
    },
  );
  for (const trait of traits[card.name] ?? []) {
    accumulator.add(draft.sceneStem, { kind: 'trait', value: trait });
  }

  for (const utterance of extractQuotedUtterancesForCharacter(draft.body, card.name, aliases)) {
    accumulator.add(draft.sceneStem, { kind: 'recentDialogue', value: utterance });
  }
}

async function buildCharacterProposals(
  card: CharacterCard,
  drafts: readonly CollectDraft[],
  aiService: CardCollectAiService,
  roster: readonly CharacterRef[],
): Promise<CardCollectProposal[]> {
  const context: CharacterProposalContext = {
    card,
    aiService,
    aliases: card.aliases ?? [],
    primary: { kind: 'character', id: card.id },
    resolveTarget: buildTargetResolver(roster),
    accumulator: new ProposalAccumulator(),
  };

  for (const draft of drafts) {
    await addDraftCharacterProposals(context, draft);
  }

  return context.accumulator.finalize(card);
}

async function buildBackgroundProposals(
  card: BackgroundCard,
  drafts: readonly CollectDraft[],
  aiService: CardCollectAiService,
  roster: readonly CharacterRef[],
): Promise<CardCollectProposal[]> {
  const idByName: Map<string, string> = new Map(roster.map((entry) => [entry.name, entry.id]));
  const accumulator: ProposalAccumulator = new ProposalAccumulator();
  const primary: EntityRef = { kind: 'background', id: card.id };

  for (const draft of drafts) {
    const attribution: UsageAttribution = attributionFor(primary, draft.sceneStem);
    const facts: BackgroundFactExtraction = await aiService.extractBackgroundFactsFromDraft(
      draft.body,
      card.name,
      {
        attribution,
      },
    );

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
      const id: string | undefined = idByName.get(name);
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
  const drafts: CollectDraft[] = filterDraftsForCard(input.card, input.drafts);

  if (drafts.length === 0) {
    return [];
  }

  return input.card.type === 'character'
    ? buildCharacterProposals(input.card, drafts, input.aiService, input.characterRoster)
    : buildBackgroundProposals(input.card, drafts, input.aiService, input.characterRoster);
}
