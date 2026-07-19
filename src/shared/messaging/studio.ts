import { z } from 'zod';

import { uriStringSchema } from './atoms';

export const studioActionSchema = z.enum([
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

export const studioTargetSchema = z.object({
  kind: z.enum(['draft', 'scene', 'project', 'none']),
  label: z.string().optional(),
  sceneUri: uriStringSchema.optional(),
  draftUri: uriStringSchema.optional(),
  hasSelection: z.boolean(),
  draftExists: z.boolean().optional(),
});

export type StudioTarget = z.infer<typeof studioTargetSchema>;

export const studioRunActionRequestPayloadSchema = z.object({
  action: studioActionSchema,
  instruction: z.string().optional(),
});

export const studioRunActionResponsePayloadSchema = z.object({});

export const studioTurnStatusSchema = z.enum(['pending', 'running', 'done', 'failed', 'cancelled']);

export const studioClarifyReasonSchema = z.enum([
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

export const studioSessionSnapshotSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  title: z.string(),
  turns: z.array(studioChatTurnSchema),
});

export type StudioSessionSnapshot = z.infer<typeof studioSessionSnapshotSchema>;

export const studioSessionSummarySchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  updatedAt: z.string().datetime(),
  turnCount: z.number().int().nonnegative(),
});

export type StudioSessionSummary = z.infer<typeof studioSessionSummarySchema>;

export const studioSessionSaveRequestPayloadSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().datetime(),
  turns: z.array(studioChatTurnSchema).min(1),
});

export const studioSessionSaveResponsePayloadSchema = z.object({});

export const studioSessionListRequestPayloadSchema = z.object({});

export const studioSessionListResponsePayloadSchema = z.object({
  sessions: z.array(studioSessionSummarySchema),
});

export const studioSessionLoadRequestPayloadSchema = z.object({
  id: z.string().min(1),
});

export const studioSessionLoadResponsePayloadSchema = z.object({
  session: studioSessionSnapshotSchema.optional(),
});
