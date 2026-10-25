import {
  deriveNarrationFromPointOfView,
  mainThreadId,
  resolveCompositionPresetDefaults,
} from '@storyboard/story-model';
import type {
  CompositionKind,
  CompositionPresetDefaults,
  NarratorCard,
  NarratorKnowledge,
  NarratorPerson,
  PointOfView,
  PointOfViewDerivation,
  ProjectSetting,
  StoryThread,
} from '@storyboard/story-model';

export interface CompositionPresetRequest {
  readonly composition: CompositionKind;
  readonly episodeCount?: number;
  readonly povCharacters?: readonly string[];
  readonly pov?: PointOfView;
}

export type CompositionPresetSetting = Pick<
  ProjectSetting,
  'composition' | 'threads' | 'narration'
>;

export interface CompositionPreset {
  readonly setting: CompositionPresetSetting;
  readonly narratorCards: readonly NarratorCard[];
}

export function buildCompositionPreset(request: CompositionPresetRequest): CompositionPreset {
  switch (request.composition) {
    case 'linear':
      return { setting: { composition: 'linear' }, narratorCards: [] };
    case 'omnibus':
      return { setting: buildOmnibusSetting(request), narratorCards: [] };
    case 'alternating-pov':
      return buildAlternatingPovPreset(request);
    case 'frame':
      return { setting: buildFrameSetting(), narratorCards: [] };
  }
}

function buildOmnibusSetting(request: CompositionPresetRequest): CompositionPresetSetting {
  const defaults: CompositionPresetDefaults = resolveCompositionPresetDefaults();
  const episodeCount: number = Math.max(
    defaults.minimumOmnibusEpisodes,
    request.episodeCount ?? defaults.omnibusEpisodeCount,
  );
  const threads: Record<string, StoryThread> = {};

  for (let episode: number = 1; episode <= episodeCount; episode += 1) {
    const threadId: string = `${defaults.episodeThreadIdPrefix}${episode}`;
    threads[threadId] = { title: `${episode}${defaults.episodeTitleSuffix}` };
  }

  return { composition: 'omnibus', threads };
}

function buildFrameSetting(): CompositionPresetSetting {
  const defaults: CompositionPresetDefaults = resolveCompositionPresetDefaults();

  return {
    composition: 'frame',
    threads: {
      [defaults.frameThreadId]: {
        title: defaults.frameThreadTitle,
        wraps: [defaults.innerThreadId],
      },
      [defaults.innerThreadId]: {
        title: defaults.innerThreadTitle,
      },
    },
  };
}

function buildAlternatingPovPreset(request: CompositionPresetRequest): CompositionPreset {
  const narratorCards: NarratorCard[] = (request.povCharacters ?? []).map((characterId) =>
    buildNarratorCard(characterId, request.pov),
  );
  const firstNarrator: NarratorCard | undefined = narratorCards[0];

  return {
    setting: {
      composition: 'alternating-pov',
      threads: {
        [mainThreadId]: { title: resolveCompositionPresetDefaults().mainThreadTitle },
      },
      ...(firstNarrator ? { narration: { defaultNarrator: firstNarrator.id } } : {}),
    },
    narratorCards,
  };
}

const fallbackNarration: PointOfViewDerivation = { person: 'third', knowledge: 'witnessed' };

function buildNarratorCard(characterId: string, pov: PointOfView | undefined): NarratorCard {
  const derived: PointOfViewDerivation = pov
    ? deriveNarrationFromPointOfView(pov)
    : fallbackNarration;
  const person: NarratorPerson = derived.person;
  const knowledge: NarratorKnowledge = derived.knowledge;

  return {
    type: 'narrator',
    id: `${characterId}-pov`,
    name: `${characterId}의 시점`,
    person,
    knowledge,
    focal: characterId,
  };
}
