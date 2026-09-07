import { mainThreadId } from '@storyboard/story-format';
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

const defaultEpisodeCount = 3;
const frameThreadId = 'frame';
const innerThreadId = 'inner';

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
  const episodeCount = Math.max(2, request.episodeCount ?? defaultEpisodeCount);
  const threads: Record<string, StoryThread> = {};

  for (let episode = 1; episode <= episodeCount; episode += 1) {
    threads[`ep${episode}`] = { title: `${episode}편` };
  }

  return { composition: 'omnibus', threads };
}

function buildFrameSetting(): CompositionPresetSetting {
  return {
    composition: 'frame',
    threads: {
      [frameThreadId]: { title: '외화', wraps: [innerThreadId] },
      [innerThreadId]: { title: '내화' },
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
      threads: { [mainThreadId]: { title: '본편' } },
      ...(firstNarrator ? { narration: { defaultNarrator: firstNarrator.id } } : {}),
    },
    narratorCards,
  };
}

function buildNarratorCard(characterId: string, pov: PointOfView | undefined): NarratorCard {
  const person: NarratorPerson = pov === 'first' || pov === 'first-retrospective' ? 'first' : 'third';
  const knowledge: NarratorKnowledge = pov === 'first-retrospective' ? 'retrospective' : 'witnessed';

  return {
    type: 'narrator',
    id: `${characterId}-pov`,
    name: `${characterId}의 시점`,
    person,
    knowledge,
    focal: characterId,
  };
}
