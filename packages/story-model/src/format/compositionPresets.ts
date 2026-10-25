import { z } from 'zod';

import compositionPresetData from './compositionPresets.params.json';

const compositionPresetDefaultsShape = {
  omnibusEpisodeCount: z.number().int().min(1),
  minimumOmnibusEpisodes: z.number().int().min(1),
  episodeThreadIdPrefix: z.string().trim().min(1),
  episodeTitleSuffix: z.string(),
  frameThreadId: z.string().trim().min(1),
  frameThreadTitle: z.string().trim().min(1),
  innerThreadId: z.string().trim().min(1),
  innerThreadTitle: z.string().trim().min(1),
  mainThreadTitle: z.string().trim().min(1),
} satisfies z.ZodRawShape;

export interface CompositionPresetDefaults {
  omnibusEpisodeCount: number;
  minimumOmnibusEpisodes: number;
  episodeThreadIdPrefix: string;
  episodeTitleSuffix: string;
  frameThreadId: string;
  frameThreadTitle: string;
  innerThreadId: string;
  innerThreadTitle: string;
  mainThreadTitle: string;
}

export const compositionPresetDefaultsSchema: z.ZodType<CompositionPresetDefaults> = z.object(
  compositionPresetDefaultsShape,
);

export interface CompositionPresetOverride {
  omnibusEpisodeCount?: number;
  minimumOmnibusEpisodes?: number;
  episodeThreadIdPrefix?: string;
  episodeTitleSuffix?: string;
  frameThreadId?: string;
  frameThreadTitle?: string;
  innerThreadId?: string;
  innerThreadTitle?: string;
  mainThreadTitle?: string;
}

export const compositionPresetOverrideSchema: z.ZodType<CompositionPresetOverride> = z
  .object(compositionPresetDefaultsShape)
  .partial()
  .strict();

export const compositionPresetDefaults: CompositionPresetDefaults =
  compositionPresetDefaultsSchema.parse(compositionPresetData);

let currentCompositionPresetDefaults: CompositionPresetDefaults = compositionPresetDefaults;

export function overrideCompositionPresetDefaults(override: CompositionPresetOverride): void {
  currentCompositionPresetDefaults = { ...currentCompositionPresetDefaults, ...override };
}

export function resetCompositionPresetDefaults(): void {
  currentCompositionPresetDefaults = compositionPresetDefaults;
}

export function resolveCompositionPresetDefaults(): CompositionPresetDefaults {
  return currentCompositionPresetDefaults;
}
