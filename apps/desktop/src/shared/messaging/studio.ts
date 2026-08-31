import { z } from 'zod';

import { uriStringSchema } from './atoms';

const studioActionSchema = z.enum([
  'regenerate',
  'generate',
  'applyFormat',
  'grammarCheck',
  'continuityCheck',
  'expand',
  'augment',
  'augmentSelection',
  'editSelection',
  'condense',
  'completeStory',
  'buildCardsFromScenes',
]);

export type StudioAction = z.infer<typeof studioActionSchema>;

export const studioEntityKindSchema = z.enum(['character', 'background', 'scene', 'project']);

export type StudioEntityKind = z.infer<typeof studioEntityKindSchema>;

export const studioEntitySchema = z.object({
  kind: studioEntityKindSchema,
  key: z.string().min(1),
});

export type StudioEntity = z.infer<typeof studioEntitySchema>;

export const studioTargetSchema = z.object({
  kind: z.enum(['draft', 'scene', 'character', 'background', 'project', 'none']),
  label: z.string().optional(),
  // NOTE: draft and scene targets share one entity so their chat sessions live under the same key.
  entity: studioEntitySchema.optional(),
  sceneUri: uriStringSchema.optional(),
  draftUri: uriStringSchema.optional(),
  cardUri: uriStringSchema.optional(),
  hasSelection: z.boolean(),
  draftExists: z.boolean().optional(),
});

export type StudioTarget = z.infer<typeof studioTargetSchema>;

export const studioStageCardSchema = z.object({
  kind: z.enum(['character', 'background']),
  name: z.string().min(1),
});

export const studioSceneStageSchema = z.object({
  kind: z.literal('scene'),
  sceneStem: z.string().min(1),
  title: z.string().optional(),
  draftLength: z.number().int().nonnegative().optional(),
  draftUpdatedAt: z.string().datetime().optional(),
  draftRevision: z.number().int().positive().optional(),
  review: z.enum(['unreviewed', 'clean', 'issues']),
  cards: z.array(studioStageCardSchema),
});

export const studioCardStageRelationSchema = z.object({
  target: z.string().min(1),
  type: z.string().min(1),
});

export const studioCardStageSchema = z.object({
  kind: z.literal('card'),
  cardKind: z.enum(['character', 'background']),
  cardId: z.string().min(1),
  name: z.string().min(1),
  role: z.string().optional(),
  relations: z.array(studioCardStageRelationSchema),
  appearsInScenes: z.array(z.string().min(1)),
});

export const studioStageSchema = z.discriminatedUnion('kind', [
  studioSceneStageSchema,
  studioCardStageSchema,
]);

export type StudioStageCard = z.infer<typeof studioStageCardSchema>;
export type StudioSceneStage = z.infer<typeof studioSceneStageSchema>;
export type StudioCardStage = z.infer<typeof studioCardStageSchema>;
export type StudioCardStageRelation = z.infer<typeof studioCardStageRelationSchema>;
export type StudioStage = z.infer<typeof studioStageSchema>;

export const studioStageRequestPayloadSchema = z.object({});

export const studioStageResponsePayloadSchema = z.object({
  stage: studioStageSchema.optional(),
});

export const studioRunActionRequestPayloadSchema = z.object({
  action: studioActionSchema,
  instruction: z.string().optional(),
});

export const studioRunActionResponsePayloadSchema = z.object({});

const studioTurnStatusSchema = z.enum(['pending', 'running', 'done', 'failed', 'cancelled']);

const studioClarifyReasonSchema = z.enum([
  'no-target',
  'needs-selection',
  'needs-draft',
  'ambiguous',
]);

const studioUserTurnSchema = z.object({
  id: z.string().min(1),
  role: z.literal('user'),
  text: z.string(),
});

const studioProposalTurnSchema = z.object({
  id: z.string().min(1),
  role: z.literal('assistant'),
  kind: z.literal('proposal'),
  action: studioActionSchema,
  instruction: z.string().optional(),
  status: studioTurnStatusSchema,
  errorMessage: z.string().optional(),
});

const studioClarifyTurnSchema = z.object({
  id: z.string().min(1),
  role: z.literal('assistant'),
  kind: z.literal('clarify'),
  reason: studioClarifyReasonSchema,
  suggestions: z.array(studioActionSchema),
});

export const studioChatTurnSchema = z.union([
  studioUserTurnSchema,
  studioProposalTurnSchema,
  studioClarifyTurnSchema,
]);

export type StudioChatTurn = z.infer<typeof studioChatTurnSchema>;

const studioSessionSnapshotSchema = z.object({
  id: z.string().min(1),
  entity: studioEntitySchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  title: z.string(),
  hasAppliedChanges: z.boolean(),
  turns: z.array(studioChatTurnSchema),
});

export type StudioSessionSnapshot = z.infer<typeof studioSessionSnapshotSchema>;

const studioSessionSummarySchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  updatedAt: z.string().datetime(),
  turnCount: z.number().int().nonnegative(),
  hasAppliedChanges: z.boolean(),
});

export type StudioSessionSummary = z.infer<typeof studioSessionSummarySchema>;

export const studioSessionSaveRequestPayloadSchema = z.object({
  id: z.string().min(1),
  entity: studioEntitySchema,
  createdAt: z.string().datetime(),
  hasAppliedChanges: z.boolean(),
  turns: z.array(studioChatTurnSchema).min(1),
});

export const studioSessionSaveResponsePayloadSchema = z.object({});

export const studioSessionListRequestPayloadSchema = z.object({
  entity: studioEntitySchema,
});

export const studioSessionListResponsePayloadSchema = z.object({
  sessions: z.array(studioSessionSummarySchema),
});

export const studioSessionLoadRequestPayloadSchema = z.object({
  entity: studioEntitySchema,
  id: z.string().min(1),
});

export const studioSessionLoadResponsePayloadSchema = z.object({
  session: studioSessionSnapshotSchema.optional(),
});
