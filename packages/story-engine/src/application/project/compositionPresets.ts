import {
  compositionPresetDefaults,
  deriveNarrationFromPointOfView,
  mainThreadId,
} from '@storyboard/story-format';
import type {
  CompositionKind,
  NarratorCard,
  NarratorKnowledge,
  NarratorPerson,
  PointOfView,
  ProjectSetting,
  StoryThread,
} from '@storyboard/story-format';

// NOTE: 창작자는 구성 하나를 고르고, 줄기와 서술자 카드는 프리셋이 만든다. 스레드·서술자를 손으로
// 조합할 줄 알아야만 옴니버스를 쓸 수 있게 두면 시점 3택만 알던 사용자가 갈 곳이 없어진다.
export interface CompositionPresetRequest {
  readonly composition: CompositionKind;
  // 옴니버스가 만들 편 수. 두 편 미만은 옴니버스가 아니므로 최소 2로 올린다.
  readonly episodeCount?: number;
  // 시점 교차가 서술자 카드를 만들 인물 id.
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
  const episodeCount = Math.max(
    compositionPresetDefaults.minimumOmnibusEpisodes,
    request.episodeCount ?? compositionPresetDefaults.omnibusEpisodeCount,
  );
  const threads: Record<string, StoryThread> = {};

  for (let episode = 1; episode <= episodeCount; episode += 1) {
    const threadId = `${compositionPresetDefaults.episodeThreadIdPrefix}${episode}`;
    threads[threadId] = { title: `${episode}${compositionPresetDefaults.episodeTitleSuffix}` };
  }

  return { composition: 'omnibus', threads };
}

function buildFrameSetting(): CompositionPresetSetting {
  return {
    composition: 'frame',
    threads: {
      [compositionPresetDefaults.frameThreadId]: {
        title: compositionPresetDefaults.frameThreadTitle,
        wraps: [compositionPresetDefaults.innerThreadId],
      },
      [compositionPresetDefaults.innerThreadId]: {
        title: compositionPresetDefaults.innerThreadTitle,
      },
    },
  };
}

function buildAlternatingPovPreset(request: CompositionPresetRequest): CompositionPreset {
  const narratorCards = (request.povCharacters ?? []).map((characterId) =>
    buildNarratorCard(characterId, request.pov),
  );
  const firstNarrator = narratorCards[0];

  return {
    setting: {
      composition: 'alternating-pov',
      threads: { [mainThreadId]: { title: compositionPresetDefaults.mainThreadTitle } },
      ...(firstNarrator ? { narration: { defaultNarrator: firstNarrator.id } } : {}),
    },
    narratorCards,
  };
}

// 시점에서 인칭·지식 경계를 뽑는 표는 story-format 이 갖는다. 여기서 다시 계산하던 시절에는
// 2인칭이 3인칭 서술자로, 전지적 시점이 목격 서술자로 만들어졌다.
const fallbackNarration = { person: 'third', knowledge: 'witnessed' } as const;

function buildNarratorCard(characterId: string, pov: PointOfView | undefined): NarratorCard {
  const derived = pov ? deriveNarrationFromPointOfView(pov) : fallbackNarration;
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
