import { z } from 'zod';

export const cardIdPattern = /^[a-z0-9][a-z0-9-]*$/;

export const cardTypes = ['character', 'location', 'temporal', 'social'] as const;

export const characterRoles = ['main', 'supporting', 'extra'] as const;
export type CharacterRole = (typeof characterRoles)[number];

export function isCharacterRole(value: string | undefined): value is CharacterRole {
  return value === 'main' || value === 'supporting' || value === 'extra';
}

// Decision #29: forgive casing and the known near-miss "support", but surface anything else as a
// validation error instead of silently demoting the character to an extra — a lenient fallback
// here rewrites authorial intent on the next save.
export const characterRoleSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null) {
      return undefined;
    }

    if (typeof value !== 'string') {
      return value;
    }

    const normalized = value.trim().toLowerCase();
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

const cardIdSchema = z.string().regex(cardIdPattern, {
  message: 'Card id must use lowercase letters, numbers, and hyphens.',
});

const stringListSchema = z.array(z.string());
const cardAttributeValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const characterRelationSchema = z.object({
  target: cardIdSchema,
  type: z.string().trim().min(1),
});

export const characterArcSchema = z.object({
  stage: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  sceneRef: z.string().trim().min(1).optional(),
});

export const characterCardSchema = z.object({
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
  desire: stringListSchema.optional(),
  relations: z.array(characterRelationSchema).optional(),
  arc: z.array(characterArcSchema).optional(),
  recentDialogues: stringListSchema.optional(),
});

const backgroundBaseFields = {
  id: cardIdSchema,
  name: z.string().trim().min(1),
  aliases: stringListSchema.optional(),
  description: stringListSchema.default([]),
  characterIds: stringListSchema.default([]),
  tags: stringListSchema.default([]),
  time: z.string().trim().min(1).optional(),
  weather: z.string().trim().min(1).optional(),
  senses: stringListSchema.optional(),
};

export const locationBackgroundSchema = z.object({
  type: z.literal('location'),
  ...backgroundBaseFields,
  locationKind: z.enum(['place', 'affiliation']).default('place'),
});

export const temporalBackgroundSchema = z.object({
  type: z.literal('temporal'),
  ...backgroundBaseFields,
});

export const socialBackgroundSchema = z.object({
  type: z.literal('social'),
  ...backgroundBaseFields,
});

export const backgroundCardSchema = z.discriminatedUnion('type', [
  locationBackgroundSchema,
  temporalBackgroundSchema,
  socialBackgroundSchema,
]);

export const cardSchema = z.discriminatedUnion('type', [
  characterCardSchema,
  locationBackgroundSchema,
  temporalBackgroundSchema,
  socialBackgroundSchema,
]);

export type CardType = (typeof cardTypes)[number];
export type CharacterRelation = z.infer<typeof characterRelationSchema>;
export type CharacterArc = z.infer<typeof characterArcSchema>;
export type CharacterCard = z.infer<typeof characterCardSchema>;
export type LocationBackgroundCard = z.infer<typeof locationBackgroundSchema>;
export type TemporalBackgroundCard = z.infer<typeof temporalBackgroundSchema>;
export type SocialBackgroundCard = z.infer<typeof socialBackgroundSchema>;
export type BackgroundCard = LocationBackgroundCard | TemporalBackgroundCard | SocialBackgroundCard;
export type StoryboardCard = z.infer<typeof cardSchema>;

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
