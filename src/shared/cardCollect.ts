import { z } from 'zod';

const proposalBaseFields = {
  id: z.string().min(1),
  sourceScenes: z.array(z.string()),
};

export const cardCollectProposalSchema = z.discriminatedUnion('kind', [
  z.object({
    ...proposalBaseFields,
    kind: z.literal('attribute'),
    key: z.string().min(1),
    value: z.string().min(1),
    before: z.string().optional(),
  }),
  z.object({
    ...proposalBaseFields,
    kind: z.literal('relation'),
    target: z.string().min(1),
    type: z.string().min(1),
    before: z.string().optional(),
  }),
  z.object({
    ...proposalBaseFields,
    kind: z.literal('arc'),
    stage: z.string().min(1).optional(),
    summary: z.string().min(1),
    sceneRef: z.string().min(1),
    before: z.string().optional(),
  }),
  z.object({ ...proposalBaseFields, kind: z.literal('trait'), value: z.string().min(1) }),
  z.object({ ...proposalBaseFields, kind: z.literal('recentDialogue'), value: z.string().min(1) }),
  z.object({ ...proposalBaseFields, kind: z.literal('descriptionLine'), value: z.string().min(1) }),
  z.object({ ...proposalBaseFields, kind: z.literal('voiceLine'), value: z.string().min(1) }),
  z.object({ ...proposalBaseFields, kind: z.literal('desireLine'), value: z.string().min(1) }),
  z.object({ ...proposalBaseFields, kind: z.literal('sense'), value: z.string().min(1) }),
  z.object({
    ...proposalBaseFields,
    kind: z.literal('scalar'),
    field: z.enum(['time', 'weather']),
    before: z.string().optional(),
    after: z.string().min(1),
  }),
  z.object({ ...proposalBaseFields, kind: z.literal('characterId'), value: z.string().min(1) }),
]);

export type CardCollectProposal = z.infer<typeof cardCollectProposalSchema>;

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

export type CardCollectProposalDraft = DistributiveOmit<CardCollectProposal, 'id' | 'sourceScenes'>;

// NOTE: Keyed fields (attribute/relation/arc/scalar) dedupe by their identity key only — not the
// value — so a changed value surfaces as one update proposal instead of a duplicate. Free-form list
// kinds key by value (append-only).
export function cardCollectProposalId(proposal: CardCollectProposalDraft): string {
  switch (proposal.kind) {
    case 'attribute':
      return `attribute:${proposal.key}`;
    case 'relation':
      return `relation:${proposal.target}`;
    case 'arc':
      return `arc:${proposal.sceneRef}`;
    case 'scalar':
      return `scalar:${proposal.field}`;
    case 'characterId':
      return `characterId:${proposal.value}`;
    default:
      return `${proposal.kind}:${proposal.value}`;
  }
}
