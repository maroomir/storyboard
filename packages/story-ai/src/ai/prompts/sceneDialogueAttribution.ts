import { type PromptArtifact, type PromptVariantId } from './types';

export interface DialogueAttributionCandidate {
  readonly id: string;
  readonly name: string;
}

export interface SceneDialogueAttributionInput {
  readonly skeleton: string;
  readonly lines: readonly string[];
  readonly candidates: readonly DialogueAttributionCandidate[];
}

// NOTE: 원고에는 손대지 않고 화자만 읽어내는 단계다. 본문 생성 프롬프트를 건드리지 않으려고 별도
// 호출로 분리했으므로, 여기서는 절대 문장을 고쳐 쓰지 않는다.
export const SceneDialogueAttributionPrompt = {
  config: {
    temperature: 0,
    maxTokens: 4000,
  },
  build(
    input: SceneDialogueAttributionInput,
    variant: PromptVariantId = 'generic',
  ): PromptArtifact {
    return variant === 'xs' ? buildXs(input) : buildGeneric(input);
  },
} as const;

function buildGeneric(input: SceneDialogueAttributionInput): PromptArtifact {
  return {
    system: [
      '장면 본문과 그 안의 대사 목록을 받아 각 대사를 누가 말했는지 판별한다.',
      '본문을 고치거나 새로 쓰지 마라. 판별 결과만 낸다.',
      '화자는 반드시 주어진 인물 id 중 하나로 적어라. 본문만으로 확신할 수 없으면 "unknown"으로 적어라.',
      '추측으로 채우지 마라. 번갈아 말하는 흐름이 끊긴 자리에서는 unknown이 옳은 답이다.',
      '설명 없이 JSON 배열만 출력하라: [{"index": 1, "speaker": "kailen"}]',
    ].join('\n'),
    user: buildUserBlock(input),
  };
}

function buildXs(input: SceneDialogueAttributionInput): PromptArtifact {
  return {
    system:
      '각 대사의 화자를 주어진 인물 id로 판별하라. 확신 없으면 "unknown". 본문 수정 금지. JSON 배열만 출력: [{"index":1,"speaker":"id"}]',
    user: buildUserBlock(input),
  };
}

function buildUserBlock(input: SceneDialogueAttributionInput): string {
  const candidateLines = input.candidates.map(
    (candidate) => `- ${candidate.id}: ${candidate.name}`,
  );
  const numberedLines = input.lines.map((line, offset) => `${offset + 1}. ${line}`);

  return [
    '[인물 명단]',
    ...candidateLines,
    `\n[본문]\n${input.skeleton}`,
    `\n[대사 목록]\n${numberedLines.join('\n')}`,
  ].join('\n');
}
