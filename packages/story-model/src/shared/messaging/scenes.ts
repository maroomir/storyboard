import { z } from 'zod';

import { uriStringSchema } from '#model/shared/messaging/atoms';

export interface ScenesListRequestPayload {
  [key: string]: never;
}

export const scenesListRequestPayloadSchema: z.ZodType<ScenesListRequestPayload> = z.object({});

export interface SceneListItem {
  stem: string;
  order: number;
  slug: string;
  sceneUri: string;
  status: 'ready' | 'stale' | 'missing';
  sceneMtime: number;
  title?: string;
  draftUri?: string;
  draftMtime?: number;
  outlineStale?: boolean;
}

const sceneListItemSchema: z.ZodType<SceneListItem> = z.object({
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

export interface ScenesListResponsePayload {
  scenes: SceneListItem[];
}

export const scenesListResponsePayloadSchema: z.ZodType<ScenesListResponsePayload> = z.object({
  scenes: z.array(sceneListItemSchema),
});

export interface ScenesOpenSceneRequestPayload {
  uri: string;
}

export const scenesOpenSceneRequestPayloadSchema: z.ZodType<ScenesOpenSceneRequestPayload> =
  z.object({
    uri: uriStringSchema,
  });

export interface ScenesOpenDraftRequestPayload {
  uri: string;
}

export const scenesOpenDraftRequestPayloadSchema: z.ZodType<ScenesOpenDraftRequestPayload> =
  z.object({
    uri: uriStringSchema,
  });

export interface ScenesGenerateDraftRequestPayload {
  uri: string;
}

export const scenesGenerateDraftRequestPayloadSchema: z.ZodType<ScenesGenerateDraftRequestPayload> =
  z.object({
    uri: uriStringSchema,
  });

export interface ScenesOpenSceneResponsePayload {
  [key: string]: never;
}

export const scenesOpenSceneResponsePayloadSchema: z.ZodType<ScenesOpenSceneResponsePayload> =
  z.object({});
export interface ScenesOpenDraftResponsePayload {
  [key: string]: never;
}

export const scenesOpenDraftResponsePayloadSchema: z.ZodType<ScenesOpenDraftResponsePayload> =
  z.object({});
export interface ScenesGenerateDraftResponsePayload {
  [key: string]: never;
}

export const scenesGenerateDraftResponsePayloadSchema: z.ZodType<ScenesGenerateDraftResponsePayload> =
  z.object({});
