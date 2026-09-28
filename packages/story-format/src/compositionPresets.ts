import { z } from 'zod';

import compositionPresetData from './compositionPresets.params.json';

// 구성 프리셋이 만들 줄기의 이름과 개수. 프리셋·계약 검사·CLI 도움말이 같은 값을 봐야 «편 두 개
// 이상»이라는 경고와 실제로 만들어지는 편 수가 어긋나지 않는다. 기본값은 compositionPresets.params.json
// 에 있고, 작가는 같은 꼴의 파일을 홈·작품에 두어 그 위에 덮는다.
export const compositionPresetDefaultsSchema = z.object({
  omnibusEpisodeCount: z.number().int().min(1),
  minimumOmnibusEpisodes: z.number().int().min(1),
  episodeThreadIdPrefix: z.string().trim().min(1),
  episodeTitleSuffix: z.string(),
  frameThreadId: z.string().trim().min(1),
  frameThreadTitle: z.string().trim().min(1),
  innerThreadId: z.string().trim().min(1),
  innerThreadTitle: z.string().trim().min(1),
  mainThreadTitle: z.string().trim().min(1),
});

export type CompositionPresetDefaults = z.infer<typeof compositionPresetDefaultsSchema>;

export const compositionPresetOverrideSchema = compositionPresetDefaultsSchema.partial();

export type CompositionPresetOverride = z.infer<typeof compositionPresetOverrideSchema>;

export const compositionPresetDefaults: CompositionPresetDefaults =
  compositionPresetDefaultsSchema.parse(compositionPresetData);

let currentCompositionPresetDefaults: CompositionPresetDefaults = compositionPresetDefaults;

export function overrideCompositionPresetDefaults(override: CompositionPresetOverride): void {
  currentCompositionPresetDefaults = { ...currentCompositionPresetDefaults, ...override };
}

export function resetCompositionPresetDefaults(): void {
  currentCompositionPresetDefaults = compositionPresetDefaults;
}

// The defaults in force: the bundled ones with the author's files laid over them.
export function resolveCompositionPresetDefaults(): CompositionPresetDefaults {
  return currentCompositionPresetDefaults;
}
