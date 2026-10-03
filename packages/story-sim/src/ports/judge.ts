import type { AiGenerateResponse, AiMessage, AiProviderId } from '@storyboard/story-model';
import type { AiProviderRegistry } from '@storyboard/story-ai';

// 심판은 계측기이지 측정 대상이 아니다. 그래서 제품의 태스크 라우팅을 타지 않고 프로바이더와
// 모델을 못박아 부르며, 사용량도 생성 원장과 섞지 않는다.
export interface SimJudge {
  readonly providerId: AiProviderId;
  readonly model: string;
  readonly ask: (messages: readonly AiMessage[]) => Promise<AiGenerateResponse>;
  readonly usage: () => readonly AiGenerateResponse[];
}

export interface JudgeSelection {
  readonly providerId: AiProviderId;
  readonly model: string;
}

export class SelfJudgingError extends Error {
  public readonly code = 'self-judging';

  public constructor(providerId: AiProviderId, model: string) {
    super(
      `심판과 생성이 같은 모델(${providerId}:${model})입니다. 자기 글을 자기가 채점하면 그 지점만 점수가 들뜹니다.`,
    );
    this.name = 'SelfJudgingError';
  }
}

// NOTE: 심판 판정은 창작이 아니라 분류에 가깝다. 온도를 낮게 못박아 같은 원고에 같은 답이 나오도록
// 한다 — 씨앗이 없으므로 이것이 재현성에 가장 가까운 수단이다.
const judgeTemperature = 0;

// NOTE: 프로바이더 이름만 보면 로컬 런타임에서 qwen 으로 쓰고 llama 로 채점하는 것까지 거부한다.
// 같은 것은 프로바이더가 아니라 «같은 가중치» 이므로 모델까지 함께 본다.
export function createSimJudge(input: {
  readonly registry: AiProviderRegistry;
  readonly judge: JudgeSelection;
  readonly generation: JudgeSelection;
  readonly allowSelfJudging?: boolean;
}): SimJudge {
  const sameModel =
    input.judge.providerId === input.generation.providerId &&
    input.judge.model === input.generation.model;

  if (sameModel && input.allowSelfJudging !== true) {
    throw new SelfJudgingError(input.judge.providerId, input.judge.model);
  }

  const responses: AiGenerateResponse[] = [];

  return {
    providerId: input.judge.providerId,
    model: input.judge.model,
    ask: async (messages) => {
      const response = await input.registry.generateWithProvider(
        input.judge.providerId,
        // 태스크 이름은 제품 프롬프트를 고르는 데 쓰이지 않는다. 사용량 기록에만 실린다.
        { taskName: 'draftCritique', messages, temperature: judgeTemperature },
        input.judge.model,
      );

      responses.push(response);
      return response;
    },
    usage: () => responses,
  };
}
