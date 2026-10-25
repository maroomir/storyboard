import { z } from 'zod';

import {
  studioAgentToolNames,
  type StudioAgentEntityKind,
  type StudioAgentToolName,
  type StudioCardFieldChange,
  type StudioDraftReplacement,
  type StudioPatch,
} from '#model/contracts/studioAgent';

import { uriStringSchema } from './atoms';
import type {
  StudioValidationState,
  StudioValidationWarning,
} from '#model/contracts/studioValidation';
import type { BibleSubjectKind } from '#model/format/bible';

export type StudioEntityKind = 'character' | 'scene' | 'background' | 'project';

export const studioEntityKindSchema: z.ZodType<StudioEntityKind> = z.enum([
  'character',
  'background',
  'scene',
  'project',
]);

export interface StudioEntity {
  kind: StudioEntityKind;
  key: string;
}

export const studioEntitySchema: z.ZodType<StudioEntity> = z.object({
  kind: studioEntityKindSchema,
  key: z.string().min(1),
});

export interface StudioTarget {
  kind: 'character' | 'scene' | 'background' | 'project' | 'draft' | 'none';
  hasSelection: boolean;
  label?: string;
  entity?: StudioEntity;
  sceneUri?: string;
  draftUri?: string;
  cardUri?: string;
  draftExists?: boolean;
}

export const studioTargetSchema: z.ZodType<StudioTarget> = z.object({
  kind: z.enum(['draft', 'scene', 'character', 'background', 'project', 'none']),
  label: z.string().optional(),
  entity: studioEntitySchema.optional(),
  sceneUri: uriStringSchema.optional(),
  draftUri: uriStringSchema.optional(),
  cardUri: uriStringSchema.optional(),
  hasSelection: z.boolean(),
  draftExists: z.boolean().optional(),
});

export interface StudioStageCard {
  kind: BibleSubjectKind;
  name: string;
}

export const studioStageCardSchema: z.ZodType<StudioStageCard> = z.object({
  kind: z.enum(['character', 'background']),
  name: z.string().min(1),
});

const studioSceneStageShape = {
  kind: z.literal('scene'),
  sceneStem: z.string().min(1),
  title: z.string().optional(),
  draftLength: z.number().int().nonnegative().optional(),
  draftUpdatedAt: z.string().datetime().optional(),
  draftRevision: z.number().int().positive().optional(),
  review: z.enum(['unreviewed', 'clean', 'issues']),
  cards: z.array(studioStageCardSchema),
} satisfies z.ZodRawShape;

export interface StudioSceneStage {
  kind: 'scene';
  sceneStem: string;
  review: 'unreviewed' | 'clean' | 'issues';
  cards: StudioStageCard[];
  title?: string;
  draftLength?: number;
  draftUpdatedAt?: string;
  draftRevision?: number;
}

export const studioSceneStageSchema: z.ZodType<StudioSceneStage> = z.object(studioSceneStageShape);

export interface StudioCardStageRelation {
  target: string;
  type: string;
}

export const studioCardStageRelationSchema: z.ZodType<StudioCardStageRelation> = z.object({
  target: z.string().min(1),
  type: z.string().min(1),
});

const studioCardStageShape = {
  kind: z.literal('card'),
  cardKind: z.enum(['character', 'background']),
  cardId: z.string().min(1),
  name: z.string().min(1),
  role: z.string().optional(),
  relations: z.array(studioCardStageRelationSchema),
  appearsInScenes: z.array(z.string().min(1)),
} satisfies z.ZodRawShape;

export interface StudioCardStage {
  kind: 'card';
  cardKind: BibleSubjectKind;
  cardId: string;
  name: string;
  relations: StudioCardStageRelation[];
  appearsInScenes: string[];
  role?: string;
}

export const studioCardStageSchema: z.ZodType<StudioCardStage> = z.object(studioCardStageShape);

export type StudioStage = StudioSceneStage | StudioCardStage;

export const studioStageSchema: z.ZodType<StudioStage> = z.discriminatedUnion('kind', [
  z.object(studioSceneStageShape),
  z.object(studioCardStageShape),
]);

export interface StudioStageRequestPayload {
  [key: string]: never;
}

export const studioStageRequestPayloadSchema: z.ZodType<StudioStageRequestPayload> = z.object({});

export interface StudioStageResponsePayload {
  stage?:
    | {
        kind: 'scene';
        sceneStem: string;
        review: 'unreviewed' | 'clean' | 'issues';
        cards: StudioStageCard[];
        title?: string;
        draftLength?: number;
        draftUpdatedAt?: string;
        draftRevision?: number;
      }
    | {
        kind: 'card';
        cardKind: BibleSubjectKind;
        cardId: string;
        name: string;
        relations: StudioCardStageRelation[];
        appearsInScenes: string[];
        role?: string;
      };
}

export const studioStageResponsePayloadSchema: z.ZodType<StudioStageResponsePayload> = z.object({
  stage: studioStageSchema.optional(),
});

export type StudioProposalStatus = 'pending' | 'applied' | 'rejected' | 'failed';

export const studioProposalStatusSchema: z.ZodType<StudioProposalStatus> = z.enum([
  'pending',
  'applied',
  'rejected',
  'failed',
]);

export const studioValidationStateSchema: z.ZodType<StudioValidationState> = z.enum([
  'pass',
  'warn',
  'skipped',
]);

export const studioValidationWarningSchema: z.ZodType<StudioValidationWarning> = z.object({
  message: z.string().min(1),
  source: z.string().optional(),
});

export interface StudioValidation {
  state: StudioValidationState;
  warnings: StudioValidationWarning[];
}

export const studioValidationSchema: z.ZodType<StudioValidation> = z.object({
  state: studioValidationStateSchema,
  warnings: z.array(studioValidationWarningSchema),
});

export const studioCardFieldChangeSchema: z.ZodType<StudioCardFieldChange> = z.object({
  field: z.string().min(1),
  value: z.union([z.string(), z.array(z.string()), z.array(z.record(z.string(), z.string()))]),
});

export const studioDraftReplacementSchema: z.ZodType<StudioDraftReplacement> = z.object({
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().nonnegative(),
  oldText: z.string(),
  newText: z.string(),
});

export const studioPatchSchema: z.ZodType<StudioPatch> = z.discriminatedUnion('target', [
  z.object({ target: z.literal('card'), changes: z.array(studioCardFieldChangeSchema).min(1) }),
  z.object({
    target: z.literal('draft'),
    replacements: z.array(studioDraftReplacementSchema).min(1),
  }),
]);

export interface StudioFollowUpTarget {
  kind: StudioAgentEntityKind;
  key: string;
  reason: string;
  instruction: string;
  targetFile: string;
}

export const studioFollowUpTargetSchema: z.ZodType<StudioFollowUpTarget> = z.object({
  kind: z.enum(['character', 'background', 'scene']),
  key: z.string().min(1),
  reason: z.string().min(1),
  instruction: z.string().min(1),
  targetFile: z.string().min(1),
});

export interface StudioUserTurn {
  id: string;
  role: 'user';
  text: string;
}

const studioUserTurnSchema: z.ZodType<StudioUserTurn> = z.object({
  id: z.string().min(1),
  role: z.literal('user'),
  text: z.string(),
});

export interface StudioSayTurn {
  id: string;
  role: 'assistant';
  kind: 'say';
  message: string;
  followUps?: StudioFollowUpTarget[];
}

const studioSayTurnSchema: z.ZodType<StudioSayTurn> = z.object({
  id: z.string().min(1),
  role: z.literal('assistant'),
  kind: z.literal('say'),
  message: z.string(),
  followUps: z.array(studioFollowUpTargetSchema).optional(),
});

export interface StudioAskTurn {
  id: string;
  role: 'assistant';
  kind: 'ask';
  question: string;
  options: string[];
}

const studioAskTurnSchema: z.ZodType<StudioAskTurn> = z.object({
  id: z.string().min(1),
  role: z.literal('assistant'),
  kind: z.literal('ask'),
  question: z.string(),
  options: z.array(z.string()),
});

export interface StudioProposalTurn {
  id: string;
  role: 'assistant';
  kind: 'proposal';
  summary: string;
  message?: string;
  targetFile: string;
  patch: StudioPatch;
  baselineHash: string;
  validation: StudioValidation;
  status: StudioProposalStatus;
  errorMessage?: string;
  followUps?: StudioFollowUpTarget[];
}

const studioProposalTurnSchema: z.ZodType<StudioProposalTurn> = z.object({
  id: z.string().min(1),
  role: z.literal('assistant'),
  kind: z.literal('proposal'),
  summary: z.string().min(1),
  message: z.string().optional(),
  targetFile: z.string().min(1),
  patch: studioPatchSchema,
  baselineHash: z.string().min(1),
  validation: studioValidationSchema,
  status: studioProposalStatusSchema,
  errorMessage: z.string().optional(),
  followUps: z.array(studioFollowUpTargetSchema).optional(),
});

export interface StudioResultTurn {
  id: string;
  role: 'assistant';
  kind: 'result';
  message: string;
}

const studioResultTurnSchema: z.ZodType<StudioResultTurn> = z.object({
  id: z.string().min(1),
  role: z.literal('assistant'),
  kind: z.literal('result'),
  message: z.string().min(1),
});

export type StudioChatTurn =
  | StudioUserTurn
  | StudioSayTurn
  | StudioAskTurn
  | StudioProposalTurn
  | StudioResultTurn;

export const studioChatTurnSchema: z.ZodType<StudioChatTurn> = z.union([
  studioUserTurnSchema,
  studioSayTurnSchema,
  studioAskTurnSchema,
  studioProposalTurnSchema,
  studioResultTurnSchema,
]);

export type StudioAgentToolNameValue = StudioAgentToolName;

export const studioAgentToolNameSchema: z.ZodType<StudioAgentToolNameValue> =
  z.enum(studioAgentToolNames);

export interface StudioChatSendRequestPayload {
  entity: StudioEntity;
  instruction: string;
  history: StudioChatTurn[];
  tool?: StudioAgentToolName;
}

export const studioChatSendRequestPayloadSchema: z.ZodType<StudioChatSendRequestPayload> = z.object(
  {
    entity: studioEntitySchema,
    instruction: z.string().min(1),
    history: z.array(studioChatTurnSchema),
    tool: studioAgentToolNameSchema.optional(),
  },
);

export interface StudioChatSendResponsePayload {
  turns: StudioChatTurn[];
}

export const studioChatSendResponsePayloadSchema: z.ZodType<StudioChatSendResponsePayload> =
  z.object({
    turns: z.array(studioChatTurnSchema),
  });

export interface StudioChatCancelRequestPayload {
  [key: string]: never;
}

export const studioChatCancelRequestPayloadSchema: z.ZodType<StudioChatCancelRequestPayload> =
  z.object({});

export interface StudioCardUpdateRequestPayload {
  description: string;
}

export const studioCardUpdateRequestPayloadSchema: z.ZodType<StudioCardUpdateRequestPayload> =
  z.object({
    description: z.string().min(1),
  });

export interface StudioCardUpdateResponsePayload {
  ok: boolean;
  message?: string;
  instruction?: string;
}

export const studioCardUpdateResponsePayloadSchema: z.ZodType<StudioCardUpdateResponsePayload> =
  z.object({
    ok: z.boolean(),
    message: z.string().optional(),
    instruction: z.string().optional(),
  });

export interface StudioChatCancelResponsePayload {
  [key: string]: never;
}

export const studioChatCancelResponsePayloadSchema: z.ZodType<StudioChatCancelResponsePayload> =
  z.object({});

export interface StudioProposalPreviewRequestPayload {
  entity: StudioEntity;
  turn: StudioChatTurn;
}

export const studioProposalPreviewRequestPayloadSchema: z.ZodType<StudioProposalPreviewRequestPayload> =
  z.object({
    entity: studioEntitySchema,
    turn: studioChatTurnSchema,
  });

export interface StudioProposalPreviewResponsePayload {
  shown: boolean;
  message?: string;
}

export const studioProposalPreviewResponsePayloadSchema: z.ZodType<StudioProposalPreviewResponsePayload> =
  z.object({
    shown: z.boolean(),
    message: z.string().optional(),
  });

export interface StudioProposalApplyRequestPayload {
  entity: StudioEntity;
  turn: StudioChatTurn;
}

export const studioProposalApplyRequestPayloadSchema: z.ZodType<StudioProposalApplyRequestPayload> =
  z.object({
    entity: studioEntitySchema,
    turn: studioChatTurnSchema,
  });

export interface StudioProposalApplyResponsePayload {
  status: StudioProposalStatus;
  message: string;
}

export const studioProposalApplyResponsePayloadSchema: z.ZodType<StudioProposalApplyResponsePayload> =
  z.object({
    status: studioProposalStatusSchema,
    message: z.string().min(1),
  });

export interface StudioFollowUpListRequestPayload {
  entity: StudioEntity;
}

export const studioFollowUpListRequestPayloadSchema: z.ZodType<StudioFollowUpListRequestPayload> =
  z.object({
    entity: studioEntitySchema,
  });

export interface StudioPendingFollowUp {
  id: string;
  origin: StudioEntity;
  reason: string;
  instruction: string;
}

export const studioPendingFollowUpSchema: z.ZodType<StudioPendingFollowUp> = z.object({
  id: z.string().min(1),
  origin: studioEntitySchema,
  reason: z.string().min(1),
  instruction: z.string().min(1),
});

export interface StudioFollowUpListResponsePayload {
  followUps: StudioPendingFollowUp[];
}

export const studioFollowUpListResponsePayloadSchema: z.ZodType<StudioFollowUpListResponsePayload> =
  z.object({
    followUps: z.array(studioPendingFollowUpSchema),
  });

export interface StudioFollowUpDismissRequestPayload {
  id: string;
}

export const studioFollowUpDismissRequestPayloadSchema: z.ZodType<StudioFollowUpDismissRequestPayload> =
  z.object({
    id: z.string().min(1),
  });

export interface StudioFollowUpDismissResponsePayload {
  [key: string]: never;
}

export const studioFollowUpDismissResponsePayloadSchema: z.ZodType<StudioFollowUpDismissResponsePayload> =
  z.object({});

export interface StudioFollowUpOpenRequestPayload {
  entity: StudioEntity;
  targetFile: string;
}

export const studioFollowUpOpenRequestPayloadSchema: z.ZodType<StudioFollowUpOpenRequestPayload> =
  z.object({
    entity: studioEntitySchema,
    targetFile: z.string().min(1),
  });

export interface StudioFollowUpOpenResponsePayload {
  opened: boolean;
}

export const studioFollowUpOpenResponsePayloadSchema: z.ZodType<StudioFollowUpOpenResponsePayload> =
  z.object({
    opened: z.boolean(),
  });

export interface StudioChatProgressEventPayload {
  stage: 'thinking' | 'looking-up' | 'validating' | 'idle';
}

export const studioChatProgressEventPayloadSchema: z.ZodType<StudioChatProgressEventPayload> =
  z.object({
    stage: z.enum(['thinking', 'looking-up', 'validating', 'idle']),
  });

export interface StudioSessionSnapshot {
  id: string;
  entity: StudioEntity;
  createdAt: string;
  updatedAt: string;
  title: string;
  hasAppliedChanges: boolean;
  turns: StudioChatTurn[];
}

const studioSessionSnapshotSchema: z.ZodType<StudioSessionSnapshot> = z.object({
  id: z.string().min(1),
  entity: studioEntitySchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  title: z.string(),
  hasAppliedChanges: z.boolean(),
  turns: z.array(studioChatTurnSchema),
});

export interface StudioSessionSummary {
  id: string;
  title: string;
  updatedAt: string;
  turnCount: number;
  hasAppliedChanges: boolean;
}

const studioSessionSummarySchema: z.ZodType<StudioSessionSummary> = z.object({
  id: z.string().min(1),
  title: z.string(),
  updatedAt: z.string().datetime(),
  turnCount: z.number().int().nonnegative(),
  hasAppliedChanges: z.boolean(),
});

export interface StudioSessionSaveRequestPayload {
  id: string;
  entity: StudioEntity;
  createdAt: string;
  hasAppliedChanges: boolean;
  turns: StudioChatTurn[];
}

export const studioSessionSaveRequestPayloadSchema: z.ZodType<StudioSessionSaveRequestPayload> =
  z.object({
    id: z.string().min(1),
    entity: studioEntitySchema,
    createdAt: z.string().datetime(),
    hasAppliedChanges: z.boolean(),
    turns: z.array(studioChatTurnSchema).min(1),
  });

export interface StudioSessionSaveResponsePayload {
  [key: string]: never;
}

export const studioSessionSaveResponsePayloadSchema: z.ZodType<StudioSessionSaveResponsePayload> =
  z.object({});

export interface StudioSessionListRequestPayload {
  entity: StudioEntity;
}

export const studioSessionListRequestPayloadSchema: z.ZodType<StudioSessionListRequestPayload> =
  z.object({
    entity: studioEntitySchema,
  });

export interface StudioSessionListResponsePayload {
  sessions: StudioSessionSummary[];
}

export const studioSessionListResponsePayloadSchema: z.ZodType<StudioSessionListResponsePayload> =
  z.object({
    sessions: z.array(studioSessionSummarySchema),
  });

export interface StudioSessionLatestRequestPayload {
  entity: StudioEntity;
}

export const studioSessionLatestRequestPayloadSchema: z.ZodType<StudioSessionLatestRequestPayload> =
  z.object({
    entity: studioEntitySchema,
  });

export interface StudioSessionLatestResponsePayload {
  session?: StudioSessionSnapshot;
}

export const studioSessionLatestResponsePayloadSchema: z.ZodType<StudioSessionLatestResponsePayload> =
  z.object({
    session: studioSessionSnapshotSchema.optional(),
  });

export interface StudioSessionLoadRequestPayload {
  entity: StudioEntity;
  id: string;
}

export const studioSessionLoadRequestPayloadSchema: z.ZodType<StudioSessionLoadRequestPayload> =
  z.object({
    entity: studioEntitySchema,
    id: z.string().min(1),
  });

export interface StudioSessionLoadResponsePayload {
  session?: StudioSessionSnapshot;
}

export const studioSessionLoadResponsePayloadSchema: z.ZodType<StudioSessionLoadResponsePayload> =
  z.object({
    session: studioSessionSnapshotSchema.optional(),
  });
