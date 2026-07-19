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
