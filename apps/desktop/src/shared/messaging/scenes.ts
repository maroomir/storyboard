import { z } from 'zod';

import { uriStringSchema } from './atoms';

export const scenesListRequestPayloadSchema = z.object({});

export const sceneListItemSchema = z.object({
  stem: z.string().trim().min(1),
  order: z.number().int(),
  slug: z.string().trim().min(1),
  title: z.string().trim().min(1).optional(),
  sceneUri: uriStringSchema,
  draftUri: uriStringSchema.optional(),
  status: z.enum(['ready', 'stale', 'missing']),
  sceneMtime: z.number(),
  draftMtime: z.number().optional(),
  outlineStale: z.boolean().optional(),
});

export type SceneListItem = z.infer<typeof sceneListItemSchema>;

export const scenesListResponsePayloadSchema = z.object({
  scenes: z.array(sceneListItemSchema),
});

export const scenesOpenSceneRequestPayloadSchema = z.object({
  uri: uriStringSchema,
});

export const scenesOpenDraftRequestPayloadSchema = z.object({
  uri: uriStringSchema,
});

export const scenesGenerateDraftRequestPayloadSchema = z.object({
  uri: uriStringSchema,
});

export const scenesOpenSceneResponsePayloadSchema = z.object({});
export const scenesOpenDraftResponsePayloadSchema = z.object({});
export const scenesGenerateDraftResponsePayloadSchema = z.object({});
