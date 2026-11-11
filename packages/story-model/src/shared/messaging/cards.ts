import { z } from 'zod';

import { characterRoles } from '#model/element/character';
import { cardSchema, cardTypes, type CardType } from '#model/format/card';
import { uriStringSchema } from '#model/shared/messaging/atoms';
import type { StoryboardCard } from '#model/format/card';

export interface CardsListRequestPayload {
  type?: CardType;
}

export const cardsListRequestPayloadSchema: z.ZodType<CardsListRequestPayload> = z.object({
  type: z.enum(cardTypes).optional(),
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

export interface CardsOpenRequestPayload {
  uri: string;
}

export const cardsOpenRequestPayloadSchema: z.ZodType<CardsOpenRequestPayload> = z.object({
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

export interface CardsOpenResponsePayload {
  [key: string]: never;
}

export const cardsOpenResponsePayloadSchema: z.ZodType<CardsOpenResponsePayload> = z.object({});
export interface CardsDeleteResponsePayload {
  [key: string]: never;
}

export const cardsDeleteResponsePayloadSchema: z.ZodType<CardsDeleteResponsePayload> = z.object({});

export interface CardsViewerActionRequestPayload {
  [key: string]: never;
}

export const cardsViewerActionRequestPayloadSchema: z.ZodType<CardsViewerActionRequestPayload> =
  z.object({});

export interface CardsViewerActionResponsePayload {
  [key: string]: never;
}

export const cardsViewerActionResponsePayloadSchema: z.ZodType<CardsViewerActionResponsePayload> =
  z.object({});
