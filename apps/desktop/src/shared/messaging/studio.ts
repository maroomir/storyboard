import { z } from 'zod';

import { uriStringSchema } from './atoms';

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

export const studioProposalStatusSchema = z.enum(['pending', 'applied', 'rejected', 'failed']);

export type StudioProposalStatus = z.infer<typeof studioProposalStatusSchema>;

export const studioValidationStateSchema = z.enum(['pass', 'warn', 'skipped']);

export const studioValidationWarningSchema = z.object({
  message: z.string().min(1),
  source: z.string().optional(),
});

export const studioValidationSchema = z.object({
  state: studioValidationStateSchema,
  warnings: z.array(studioValidationWarningSchema),
});

export type StudioValidation = z.infer<typeof studioValidationSchema>;

export const studioCardFieldChangeSchema = z.object({
  field: z.string().min(1),
  // NOTE: the object arm carries structured fields such as a character's arc; the card schema is
  // what actually validates the shape when the patch is applied.
  value: z.union([z.string(), z.array(z.string()), z.array(z.record(z.string(), z.string()))]),
});

export const studioDraftReplacementSchema = z.object({
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().nonnegative(),
  newText: z.string(),
});

export const studioPatchSchema = z.discriminatedUnion('target', [
  z.object({ target: z.literal('card'), changes: z.array(studioCardFieldChangeSchema).min(1) }),
  z.object({
    target: z.literal('draft'),
    replacements: z.array(studioDraftReplacementSchema).min(1),
  }),
]);

export type StudioPatchPayload = z.infer<typeof studioPatchSchema>;

export const studioFollowUpTargetSchema = z.object({
  kind: z.enum(['character', 'background', 'scene']),
  key: z.string().min(1),
  reason: z.string().min(1),
  instruction: z.string().min(1),
  targetFile: z.string().min(1),
});

export type StudioFollowUpTarget = z.infer<typeof studioFollowUpTargetSchema>;

const studioUserTurnSchema = z.object({
  id: z.string().min(1),
  role: z.literal('user'),
  text: z.string(),
});

const studioSayTurnSchema = z.object({
  id: z.string().min(1),
  role: z.literal('assistant'),
  kind: z.literal('say'),
  message: z.string(),
  followUps: z.array(studioFollowUpTargetSchema).optional(),
});

const studioAskTurnSchema = z.object({
  id: z.string().min(1),
  role: z.literal('assistant'),
  kind: z.literal('ask'),
  question: z.string(),
  options: z.array(z.string()),
});

const studioProposalTurnSchema = z.object({
  id: z.string().min(1),
  role: z.literal('assistant'),
  kind: z.literal('proposal'),
  summary: z.string().min(1),
  message: z.string().optional(),
  // NOTE: the proposal names the file it was built against, so approving it later cannot land on
  // whatever the author happens to have open by then.
  targetFile: z.string().min(1),
  patch: studioPatchSchema,
  // NOTE: the file bytes the patch was derived from; applying against anything else is refused.
  baselineHash: z.string().min(1),
  validation: studioValidationSchema,
  status: studioProposalStatusSchema,
  errorMessage: z.string().optional(),
  followUps: z.array(studioFollowUpTargetSchema).optional(),
});

const studioResultTurnSchema = z.object({
  id: z.string().min(1),
  role: z.literal('assistant'),
  kind: z.literal('result'),
  message: z.string().min(1),
});

export const studioChatTurnSchema = z.union([
  studioUserTurnSchema,
  studioSayTurnSchema,
  studioAskTurnSchema,
  studioProposalTurnSchema,
  studioResultTurnSchema,
]);

export type StudioChatTurn = z.infer<typeof studioChatTurnSchema>;
export type StudioProposalTurn = Extract<StudioChatTurn, { readonly kind: 'proposal' }>;

export const studioChatSendRequestPayloadSchema = z.object({
  entity: studioEntitySchema,
  instruction: z.string().min(1),
  history: z.array(studioChatTurnSchema),
});

export const studioChatSendResponsePayloadSchema = z.object({
  turns: z.array(studioChatTurnSchema),
});

export const studioChatCancelRequestPayloadSchema = z.object({});

export const studioChatCancelResponsePayloadSchema = z.object({});

export const studioProposalPreviewRequestPayloadSchema = z.object({
  entity: studioEntitySchema,
  turn: studioChatTurnSchema,
});

export const studioProposalPreviewResponsePayloadSchema = z.object({});

export const studioProposalApplyRequestPayloadSchema = z.object({
  entity: studioEntitySchema,
  turn: studioChatTurnSchema,
});

export const studioProposalApplyResponsePayloadSchema = z.object({
  status: studioProposalStatusSchema,
  message: z.string().min(1),
});

export const studioFollowUpListRequestPayloadSchema = z.object({
  entity: studioEntitySchema,
});

export const studioPendingFollowUpSchema = z.object({
  id: z.string().min(1),
  origin: studioEntitySchema,
  reason: z.string().min(1),
  instruction: z.string().min(1),
});

export type StudioPendingFollowUp = z.infer<typeof studioPendingFollowUpSchema>;

export const studioFollowUpListResponsePayloadSchema = z.object({
  followUps: z.array(studioPendingFollowUpSchema),
});

export const studioFollowUpDismissRequestPayloadSchema = z.object({
  id: z.string().min(1),
});

export const studioFollowUpDismissResponsePayloadSchema = z.object({});

export const studioFollowUpOpenRequestPayloadSchema = z.object({
  entity: studioEntitySchema,
  targetFile: z.string().min(1),
});

export const studioFollowUpOpenResponsePayloadSchema = z.object({
  opened: z.boolean(),
});

export const studioChatProgressEventPayloadSchema = z.object({
  stage: z.enum(['thinking', 'looking-up', 'validating', 'idle']),
});

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
