import { type PromptArtifact, type PromptVariantId } from './types';
import { promptTuning } from './promptTuning';

export const ContinuityCheckPrompt = {
  config: promptTuning('continuityCheck'),
  build(
    body: string,
    facts: readonly string[],
    variant: PromptVariantId = 'generic',
    hasSceneMarkers = false,
  ): PromptArtifact {
    return variant === 'xs'
      ? buildXs(body, facts, hasSceneMarkers)
      : buildGeneric(body, facts, hasSceneMarkers);
  },
} as const;

// The final review checks a whole assembled volume, so each issue has to name the scene it came
// from or it cannot be routed back to a draft file.
const sceneMarkerLine =
  '본문에는 `<!-- scene: <stem> -->` 주석이 장면마다 있다. 각 이슈의 "sceneStem"에 그 구간 직전 주석의 stem을 그대로 적어라.';

function buildGeneric(
  body: string,
  facts: readonly string[],
  hasSceneMarkers: boolean,
): PromptArtifact {
  return {
    system: [
      '한국어 소설의 설정 연속성 검사 도우미다.',
      '[설정]에 명시된 정전(canon) 사실과 본문이 모순되는 구간만 찾아라.',
      '설정에 없는 내용은 추측하지 말고, 명백히 어긋나는 구간만 보고하라.',
      '설명 없이 JSON 배열만 출력하라.',
      '[{"start":0,"end":0,"original":"","reason":"","severity":"high"}]',
      'start/end는 UTF-16 0-based, end는 exclusive다. reason에는 어떤 설정과 어떻게 모순되는지 적어라.',
      'severity는 "high"(설정과 직접 모순) 또는 "low"(모순 의심이나 해석상 양립 가능)로 표기하라.',
      ...(hasSceneMarkers ? [sceneMarkerLine] : []),
    ].join('\n'),
    user: ['[설정]', facts.join('\n'), '', '[본문]', body].join('\n'),
  };
}

function buildXs(body: string, facts: readonly string[], hasSceneMarkers: boolean): PromptArtifact {
  return {
    system: [
      '설정과 모순되는 본문 구간만 JSON 배열로 반환: [{"start":0,"end":0,"original":"","reason":"","severity":"high"}] (UTF-16 offset). severity: high=직접 모순, low=의심.',
      ...(hasSceneMarkers ? [sceneMarkerLine] : []),
    ].join('\n'),
    user: ['[설정]', facts.join('\n'), '[본문]', body].join('\n'),
  };
}
