import type { AiGenerateResponse, AiMessage, AiProviderId } from '@storyboard/story-model';
import type { AiProviderRegistry } from '@storyboard/story-ai';

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

export type SelfJudgingErrorCode = 'self-judging';

export class SelfJudgingError extends Error {
  public readonly code: SelfJudgingErrorCode = 'self-judging';

  public constructor(providerId: AiProviderId, model: string) {
    super(
      `심판과 생성이 같은 모델(${providerId}:${model})입니다. 자기 글을 자기가 채점하면 그 지점만 점수가 들뜹니다.`,
    );
    this.name = 'SelfJudgingError';
  }
}

const judgeTemperature: number = 0;

export function createSimJudge(input: {
  readonly registry: AiProviderRegistry;
  readonly judge: JudgeSelection;
  readonly generation: JudgeSelection;
  readonly allowSelfJudging?: boolean;
}): SimJudge {
  const sameModel: boolean =
    input.judge.providerId === input.generation.providerId &&
    input.judge.model === input.generation.model;

  if (sameModel && input.allowSelfJudging !== true) {
    throw new SelfJudgingError(input.judge.providerId, input.judge.model);
  }

  const responses: AiGenerateResponse[] = [];

  return {
    providerId: input.judge.providerId,
    model: input.judge.model,
    ask: async (messages: readonly AiMessage[]): Promise<AiGenerateResponse> => {
      const response: AiGenerateResponse = await input.registry.generateWithProvider(
        input.judge.providerId,
        { taskName: 'draftCritique', messages, temperature: judgeTemperature },
        input.judge.model,
      );

      responses.push(response);
      return response;
    },
    usage: () => responses,
  };
}
