import { z } from 'zod';

import { cardSchema, cardTypes, characterRoles } from '#model/format/card';
import { narratorCardSchema } from '#model/format/narrator';
import { sceneCardSchema } from '#model/format/scene';
import { cardCollectProposalSchema } from '#model/shared/cardCollect';
import { uriStringSchema } from './atoms';

export const cardsListRequestPayloadSchema = z.object({
  type: z.enum(cardTypes).optional(),
});

export const cardsReadRequestPayloadSchema = z.object({
  uri: uriStringSchema,
});

// NOTE: 카드 에디터는 scene/*.card와 narrator/*.card도 열므로 편집 RPC만 그 카드들을 함께 받는다.
// 목록·생성 계약은 entity 카드 전용으로 남는다.
const workspaceCardSchema = z.union([cardSchema, sceneCardSchema, narratorCardSchema]);

export const cardsWriteRequestPayloadSchema = z.object({
  uri: uriStringSchema,
  card: workspaceCardSchema,
  rawText: z.string().optional(),
});

export const cardsWriteRawRequestPayloadSchema = z.object({
  uri: uriStringSchema,
  rawText: z.string(),
});

export const cardsCreatePlaceholderRequestPayloadSchema = z.object({
  type: z.enum(cardTypes),
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
});

export const cardsResolveImageUriRequestPayloadSchema = z.object({
  cardUri: uriStringSchema,
  relativePath: z.string().trim().min(1),
});

export const cardsCollectRequestPayloadSchema = z.object({
  uri: uriStringSchema,
});

export const cardsApplyCollectRequestPayloadSchema = z.object({
  uri: uriStringSchema,
  accepted: z.array(cardCollectProposalSchema),
});

export const cardsPreviewCollectRequestPayloadSchema = z.object({
  uri: uriStringSchema,
  accepted: z.array(cardCollectProposalSchema),
});

export const cardsOpenRequestPayloadSchema = z.object({
  uri: uriStringSchema,
});

export const cardsStructureSceneRequestPayloadSchema = z.object({
  uri: uriStringSchema,
});

export const cardsDeleteRequestPayloadSchema = z.object({
  uri: uriStringSchema,
});

const cardSummarySchema = z.object({
  type: z.enum(cardTypes),
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  uri: uriStringSchema,
});

export type SidebarCardSummary = {
  type: (typeof cardTypes)[number];
  id: string;
  name: string;
  uri: string;
  description?: string;
  error?: string;
  role?: (typeof characterRoles)[number];
};

export const cardsListResponsePayloadSchema = z.object({
  cards: z.array(cardSummarySchema),
});

export const cardsReadResponsePayloadSchema = z.object({
  card: workspaceCardSchema,
});

export const cardsWriteResponsePayloadSchema = z.object({
  card: workspaceCardSchema,
});

export const cardsWriteRawResponsePayloadSchema = z.object({
  card: workspaceCardSchema,
  rawText: z.string(),
});

export const cardsCreatePlaceholderResponsePayloadSchema = z.object({
  card: cardSchema,
  uri: uriStringSchema,
});

export const cardsResolveImageUriResponsePayloadSchema = z.object({
  uri: uriStringSchema,
});

export const cardsCollectResponsePayloadSchema = z.object({
  proposals: z.array(cardCollectProposalSchema),
});

export const cardsApplyCollectResponsePayloadSchema = z.object({
  card: cardSchema,
});

export const cardsPreviewCollectResponsePayloadSchema = z.object({});

export const sceneStructureProposalSchema = z.object({
  purpose: z.string().optional(),
  conflict: z.string().optional(),
  twist: z.string().optional(),
  emotionalShift: z.string().optional(),
  foreshadowing: z.array(z.string()).optional(),
  neededCanon: z.array(z.string()).optional(),
});

export const cardsStructureSceneResponsePayloadSchema = z.object({
  proposal: sceneStructureProposalSchema,
});

export const cardsOpenResponsePayloadSchema = z.object({});
export const cardsDeleteResponsePayloadSchema = z.object({});
