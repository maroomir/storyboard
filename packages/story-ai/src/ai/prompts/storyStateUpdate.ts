import { type PromptArtifact, type PromptVariantId } from './types';

export interface StoryStateUpdateInput {
  readonly sceneTitle: string;
  readonly draftBody: string;
  readonly previousState?: string;
}

export const StoryStateUpdatePrompt = {
  config: {
    temperature: 0.2,
    maxTokens: 900,
  },
  build(input: StoryStateUpdateInput, variant: PromptVariantId = 'generic'): PromptArtifact {
    return variant === 'xs' ? buildXs(input) : buildGeneric(input);
  },
} as const;

function buildGeneric(input: StoryStateUpdateInput): PromptArtifact {
  return {
    system: [
      '방금 완성된 장면에서, 다음 장면을 쓸 때 반드시 지켜야 할 상태 변화만 뽑아내는 기록자다.',
      '네 항목으로 분류하라.',
      '- facts: 이 장면에서 확정된 사건·상태. 다음 장면이 이것과 모순되면 안 되는 것만.',
      '- relations: 인물 쌍의 관계 단계와 서로를 부르는 호칭·말투(존댓말/반말)의 변화.',
      '- revealed: 누가 무엇을 알게 되었는지. "인물 — 알게 된 내용" 형식으로 쓰고, 이미 밝혀진 사실이 다음 장면에서 다시 처음 공개되는 일을 막는 것이 목적이다.',
      '- motifs: 반복해서 살려야 할 단골 대사·소품·행동. 대사는 따옴표로 원문을 그대로 옮겨라.',
      '본문에 실제로 쓰인 것만 담고 추측하지 마라. 이전 상태에 이미 있는 항목은 다시 쓰지 마라.',
      '각 항목은 한 문장으로 짧게 쓰고, 항목 수는 종류당 최대 5개로 제한하라.',
      '설명 없이 JSON 객체만 출력하라.',
      '{"facts":string[],"relations":string[],"revealed":string[],"motifs":string[]}',
    ].join('\n'),
    user: buildUserBlock(input),
  };
}

function buildXs(input: StoryStateUpdateInput): PromptArtifact {
  return {
    system:
      '장면에서 다음 장면이 지켜야 할 상태만 JSON으로: {"facts":[],"relations":[],"revealed":[],"motifs":[]}. 본문 근거만, 한국어.',
    user: buildUserBlock(input),
  };
}

function buildUserBlock(input: StoryStateUpdateInput): string {
  return [
    input.previousState ? `[이전 상태]\n${input.previousState}` : undefined,
    `[장면]\n${input.sceneTitle}`,
    `[본문]\n${input.draftBody}`,
  ]
    .filter((block): block is string => Boolean(block))
    .join('\n\n');
}
