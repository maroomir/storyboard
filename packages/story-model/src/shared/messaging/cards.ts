import { z } from 'zod';

import { cardSchema, cardTypes, characterRoles, type CardType } from '#model/format/card';
import { narratorCardSchema } from '#model/format/narrator';
import { sceneCardSchema } from '#model/format/scene';
import { cardCollectProposalSchema, type CardCollectProposal } from '#model/shared/cardCollect';
import { uriStringSchema } from './atoms';
import type { StoryboardCard } from '#model/format/card';
import type { NarratorCard } from '#model/format/narrator';
import type { SceneCard } from '#model/format/scene';

export interface CardsListRequestPayload {
  type?: CardType;
}

export const cardsListRequestPayloadSchema: z.ZodType<CardsListRequestPayload> = z.object({
  type: z.enum(cardTypes).optional(),
});

export interface CardsReadRequestPayload {
  uri: string;
}

export const cardsReadRequestPayloadSchema: z.ZodType<CardsReadRequestPayload> = z.object({
  uri: uriStringSchema,
});

// NOTE: 카드 에디터는 scene/*.card와 narrator/*.card도 열므로 편집 RPC만 그 카드들을 함께 받는다.
// 목록·생성 계약은 entity 카드 전용으로 남는다.
type CardFileContent = StoryboardCard | SceneCard | NarratorCard;

const workspaceCardSchema: z.ZodType<CardFileContent> = z.union([
  cardSchema,
  sceneCardSchema,
  narratorCardSchema,
]);

export interface CardsWriteRequestPayload {
  uri: string;
  card: CardFileContent;
  rawText?: string;
}

export const cardsWriteRequestPayloadSchema: z.ZodType<CardsWriteRequestPayload> = z.object({
  uri: uriStringSchema,
  card: workspaceCardSchema,
  rawText: z.string().optional(),
});

export interface CardsWriteRawRequestPayload {
  uri: string;
  rawText: string;
}

export const cardsWriteRawRequestPayloadSchema: z.ZodType<CardsWriteRawRequestPayload> = z.object({
  uri: uriStringSchema,
  rawText: z.string(),
});

export interface CardsCreatePlaceholderRequestPayload {
  type: CardType;
  id: string;
  name: string;
}

export const cardsCreatePlaceholderRequestPayloadSchema: z.ZodType<CardsCreatePlaceholderRequestPayload> =
  z.object({
    type: z.enum(cardTypes),
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
  });

export interface CardsResolveImageUriRequestPayload {
  cardUri: string;
  relativePath: string;
}

export const cardsResolveImageUriRequestPayloadSchema: z.ZodType<CardsResolveImageUriRequestPayload> =
  z.object({
    cardUri: uriStringSchema,
    relativePath: z.string().trim().min(1),
  });

export interface CardsCollectRequestPayload {
  uri: string;
}

export const cardsCollectRequestPayloadSchema: z.ZodType<CardsCollectRequestPayload> = z.object({
  uri: uriStringSchema,
});

export interface CardsApplyCollectRequestPayload {
  uri: string;
  accepted: CardCollectProposal[];
}

export const cardsApplyCollectRequestPayloadSchema: z.ZodType<CardsApplyCollectRequestPayload> =
  z.object({
    uri: uriStringSchema,
    accepted: z.array(cardCollectProposalSchema),
  });

export interface CardsPreviewCollectRequestPayload {
  uri: string;
  accepted: CardCollectProposal[];
}

export const cardsPreviewCollectRequestPayloadSchema: z.ZodType<CardsPreviewCollectRequestPayload> =
  z.object({
    uri: uriStringSchema,
    accepted: z.array(cardCollectProposalSchema),
  });

export interface CardsOpenRequestPayload {
  uri: string;
}

export const cardsOpenRequestPayloadSchema: z.ZodType<CardsOpenRequestPayload> = z.object({
  uri: uriStringSchema,
});

export interface CardsStructureSceneRequestPayload {
  uri: string;
}

export const cardsStructureSceneRequestPayloadSchema: z.ZodType<CardsStructureSceneRequestPayload> =
  z.object({
    uri: uriStringSchema,
  });

export interface CardsDeleteRequestPayload {
  uri: string;
}

export const cardsDeleteRequestPayloadSchema: z.ZodType<CardsDeleteRequestPayload> = z.object({
  uri: uriStringSchema,
});

interface CardSummary {
  type: CardType;
  id: string;
  name: string;
  uri: string;
}

const cardSummarySchema: z.ZodType<CardSummary> = z.object({
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

export interface CardsListResponsePayload {
  cards: CardSummary[];
}

export const cardsListResponsePayloadSchema: z.ZodType<CardsListResponsePayload> = z.object({
  cards: z.array(cardSummarySchema),
});

export interface CardsReadResponsePayload {
  card: CardFileContent;
}

export const cardsReadResponsePayloadSchema: z.ZodType<CardsReadResponsePayload> = z.object({
  card: workspaceCardSchema,
});

export interface CardsWriteResponsePayload {
  card: CardFileContent;
}

export const cardsWriteResponsePayloadSchema: z.ZodType<CardsWriteResponsePayload> = z.object({
  card: workspaceCardSchema,
});

export interface CardsWriteRawResponsePayload {
  card: CardFileContent;
  rawText: string;
}

export const cardsWriteRawResponsePayloadSchema: z.ZodType<CardsWriteRawResponsePayload> = z.object(
  {
    card: workspaceCardSchema,
    rawText: z.string(),
  },
);

export interface CardsCreatePlaceholderResponsePayload {
  card: StoryboardCard;
  uri: string;
}

export const cardsCreatePlaceholderResponsePayloadSchema: z.ZodType<CardsCreatePlaceholderResponsePayload> =
  z.object({
    card: cardSchema,
    uri: uriStringSchema,
  });

export interface CardsResolveImageUriResponsePayload {
  uri: string;
}

export const cardsResolveImageUriResponsePayloadSchema: z.ZodType<CardsResolveImageUriResponsePayload> =
  z.object({
    uri: uriStringSchema,
  });

export interface CardsCollectResponsePayload {
  proposals: CardCollectProposal[];
}

export const cardsCollectResponsePayloadSchema: z.ZodType<CardsCollectResponsePayload> = z.object({
  proposals: z.array(cardCollectProposalSchema),
});

export interface CardsApplyCollectResponsePayload {
  card: StoryboardCard;
}

export const cardsApplyCollectResponsePayloadSchema: z.ZodType<CardsApplyCollectResponsePayload> =
  z.object({
    card: cardSchema,
  });

export interface CardsPreviewCollectResponsePayload {
  [key: string]: never;
}

export const cardsPreviewCollectResponsePayloadSchema: z.ZodType<CardsPreviewCollectResponsePayload> =
  z.object({});

export interface SceneStructureProposal {
  purpose?: string;
  conflict?: string;
  twist?: string;
  emotionalShift?: string;
  foreshadowing?: string[];
  neededCanon?: string[];
}

export const sceneStructureProposalSchema: z.ZodType<SceneStructureProposal> = z.object({
  purpose: z.string().optional(),
  conflict: z.string().optional(),
  twist: z.string().optional(),
  emotionalShift: z.string().optional(),
  foreshadowing: z.array(z.string()).optional(),
  neededCanon: z.array(z.string()).optional(),
});

export interface CardsStructureSceneResponsePayload {
  proposal: SceneStructureProposal;
}

export const cardsStructureSceneResponsePayloadSchema: z.ZodType<CardsStructureSceneResponsePayload> =
  z.object({
    proposal: sceneStructureProposalSchema,
  });

export interface CardsOpenResponsePayload {
  [key: string]: never;
}

export const cardsOpenResponsePayloadSchema: z.ZodType<CardsOpenResponsePayload> = z.object({});
export interface CardsDeleteResponsePayload {
  [key: string]: never;
}

export const cardsDeleteResponsePayloadSchema: z.ZodType<CardsDeleteResponsePayload> = z.object({});
