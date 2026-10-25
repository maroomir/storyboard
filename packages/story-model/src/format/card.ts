import { z } from 'zod';

export const cardIdPattern: RegExp = /^[a-z0-9][a-z0-9-]*$/;

export type CardType = 'character' | 'location' | 'temporal' | 'social';

export const cardTypes: readonly CardType[] = ['character', 'location', 'temporal', 'social'];

export type CharacterRole = 'main' | 'supporting' | 'extra';

export const characterRoles: readonly [CharacterRole, ...CharacterRole[]] = [
  'main',
  'supporting',
  'extra',
];

export function isCharacterRole(value: string | undefined): value is CharacterRole {
  return value === 'main' || value === 'supporting' || value === 'extra';
}

export const characterRoleSchema: z.ZodType<CharacterRole | undefined> = z.preprocess(
  (value) => {
    if (value === undefined || value === null) {
      return undefined;
    }

    if (typeof value !== 'string') {
      return value;
    }

    const normalized: string = value.trim().toLowerCase();
    if (normalized.length === 0) {
      return undefined;
    }

    if (normalized === 'support') {
      return 'supporting';
    }

    return normalized;
  },
  z
    .enum(characterRoles, {
      message: "role은 'main' | 'supporting' | 'extra' 중 하나여야 합니다.",
    })
    .optional(),
);

const cardIdSchema: z.ZodType<string> = z.string().regex(cardIdPattern, {
  message: 'Card id must use lowercase letters, numbers, and hyphens.',
});

const stringListSchema: z.ZodType<string[]> = z.array(z.string());
const cardAttributeValueSchema: z.ZodType<string | number | boolean | null> = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

export interface CharacterRelation {
  target: string;
  type: string;
  speech?: string;
}

export const characterRelationSchema: z.ZodType<CharacterRelation> = z.object({
  target: cardIdSchema,
  type: z.string().trim().min(1),
  speech: z.string().trim().min(1).optional(),
});

export interface CharacterArc {
  stage: string;
  summary: string;
  sceneRef?: string;
}

export const characterArcSchema: z.ZodType<CharacterArc> = z.object({
  stage: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  sceneRef: z.string().trim().min(1).optional(),
});

export interface CharacterCard {
  type: 'character';
  id: string;
  name: string;
  profile?: string;
  role?: CharacterRole;
  attributes?: Record<string, string | number | boolean | null>;
  aliases?: string[];
  tags?: string[];
  traits?: string[];
  description?: string[];
  voice?: string[];
  catchphrases?: string[];
  desire?: string[];
  relations?: CharacterRelation[];
  arc?: CharacterArc[];
  recentDialogues?: string[];
}

interface BackgroundCardFields {
  id: string;
  name: string;
  aliases?: string[];
  description: string[];
  characterIds: string[];
  tags: string[];
  time?: string;
  weather?: string;
  senses?: string[];
}

export type LocationKind = 'place' | 'affiliation';

export interface LocationBackgroundCard extends BackgroundCardFields {
  type: 'location';
  locationKind: LocationKind;
}

export interface TemporalBackgroundCard extends BackgroundCardFields {
  type: 'temporal';
}

export interface SocialBackgroundCard extends BackgroundCardFields {
  type: 'social';
}

export type BackgroundCard = LocationBackgroundCard | TemporalBackgroundCard | SocialBackgroundCard;

export type StoryboardCard = CharacterCard | BackgroundCard;

const characterCardShape = {
  type: z.literal('character'),
  id: cardIdSchema,
  name: z.string().trim().min(1),
  profile: z.string().trim().min(1).optional(),
  role: characterRoleSchema,
  attributes: z.record(z.string(), cardAttributeValueSchema).optional(),
  aliases: stringListSchema.optional(),
  tags: stringListSchema.optional(),
  traits: stringListSchema.optional(),
  description: stringListSchema.optional(),
  voice: stringListSchema.optional(),
  catchphrases: stringListSchema.optional(),
  desire: stringListSchema.optional(),
  relations: z.array(characterRelationSchema).optional(),
  arc: z.array(characterArcSchema).optional(),
  recentDialogues: stringListSchema.optional(),
} satisfies z.ZodRawShape;

const backgroundBaseShape = {
  id: cardIdSchema,
  name: z.string().trim().min(1),
  aliases: stringListSchema.optional(),
  description: stringListSchema.default([]),
  characterIds: stringListSchema.default([]),
  tags: stringListSchema.default([]),
  time: z.string().trim().min(1).optional(),
  weather: z.string().trim().min(1).optional(),
  senses: stringListSchema.optional(),
} satisfies z.ZodRawShape;

const locationBackgroundShape = {
  type: z.literal('location'),
  ...backgroundBaseShape,
  locationKind: z.enum(['place', 'affiliation']).default('place'),
} satisfies z.ZodRawShape;

const temporalBackgroundShape = {
  type: z.literal('temporal'),
  ...backgroundBaseShape,
} satisfies z.ZodRawShape;

const socialBackgroundShape = {
  type: z.literal('social'),
  ...backgroundBaseShape,
} satisfies z.ZodRawShape;

export const characterCardSchema: z.ZodType<CharacterCard> = z.object(characterCardShape);
export const locationBackgroundSchema: z.ZodType<LocationBackgroundCard> =
  z.object(locationBackgroundShape);
export const temporalBackgroundSchema: z.ZodType<TemporalBackgroundCard> =
  z.object(temporalBackgroundShape);
export const socialBackgroundSchema: z.ZodType<SocialBackgroundCard> =
  z.object(socialBackgroundShape);

export const cardSchema: z.ZodType<StoryboardCard> = z.discriminatedUnion('type', [
  z.object(characterCardShape),
  z.object(locationBackgroundShape),
  z.object(temporalBackgroundShape),
  z.object(socialBackgroundShape),
]);

export function isCardType(value: string): value is CardType {
  return cardTypes.includes(value as CardType);
}

export function isBackgroundCard(card: StoryboardCard): card is BackgroundCard {
  return card.type === 'location' || card.type === 'temporal' || card.type === 'social';
}

export function joinCardText(value: readonly string[] | undefined): string {
  return (value ?? []).join('\n');
}

export function splitCardTextToList(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.replace(/^\s*[-*•]\s+/, '').trim())
    .filter((line) => line.length > 0);
}

export function characterMatchTokens(card: CharacterCard): string[] {
  const gamename: string | number | boolean | null | undefined = card.attributes?.['gamename'];
  const tokens: string[] = [
    card.name,
    ...(card.aliases ?? []),
    ...(typeof gamename === 'string' && gamename.trim().length > 0 ? [gamename.trim()] : []),
  ];

  return [...new Set(tokens.filter((token) => token.length > 0))];
}

export function formatCardAttributes(attributes: CharacterCard['attributes']): string {
  if (!attributes) {
    return '';
  }

  return Object.entries(attributes)
    .filter((entry): entry is [string, string | number | boolean] => entry[1] !== null)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join(', ');
}
