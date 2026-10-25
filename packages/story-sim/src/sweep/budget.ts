import { computeCostUsd } from '@storyboard/story-ai';
import type { AiProviderId } from '@storyboard/story-model';

import { simDefaults } from '#sim/simDefaults';

export interface BudgetEstimate {
  readonly points: number;
  readonly repeats: number;
  readonly generationCalls: number;
  readonly judgeCalls: number;
  readonly estimatedInputTokens: number;
  readonly estimatedOutputTokens: number;
  readonly estimatedUsd: number | undefined;
  readonly estimatedWallClockHours: number;
  readonly assumptions: readonly string[];
}

export interface BaselineSample {
  readonly generationCallsPerScene: number;
  readonly inputTokensPerCall: number;
  readonly outputTokensPerCall: number;
  readonly secondsPerCall: number;
  readonly measuredAt: string;
}

export interface BudgetInput {
  readonly points: number;
  readonly sceneCount?: number;
  readonly repeats?: number;
  readonly judgeCallsPerRun: number;
  readonly generationProvider: AiProviderId;
  readonly generationModel: string;
  readonly baseline: BaselineSample;
}

export function estimateBudget(input: BudgetInput): BudgetEstimate {
  const repeats: number = input.repeats ?? simDefaults.run.repeats;
  const sceneCount: number = input.sceneCount ?? simDefaults.run.sceneCount;
  const runs: number = input.points * repeats;

  const generationCalls: number = Math.round(
    runs * sceneCount * input.baseline.generationCallsPerScene,
  );
  const judgeCalls: number = runs * input.judgeCallsPerRun;

  const estimatedInputTokens: number = generationCalls * input.baseline.inputTokensPerCall;
  const estimatedOutputTokens: number = generationCalls * input.baseline.outputTokensPerCall;

  const estimatedUsd: number | undefined = computeCostUsd({
    providerId: input.generationProvider,
    model: input.generationModel,
    usage: { inputTokens: estimatedInputTokens, outputTokens: estimatedOutputTokens },
  });

  return {
    points: input.points,
    repeats,
    generationCalls,
    judgeCalls,
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedUsd,
    estimatedWallClockHours:
      ((generationCalls + judgeCalls) * input.baseline.secondsPerCall) / 3600,
    assumptions: [
      `기준선 실측 ${input.baseline.measuredAt}`,
      `씬당 생성 호출 ${input.baseline.generationCallsPerScene}회`,
      `호출당 입력 ${input.baseline.inputTokensPerCall.toLocaleString()} · 출력 ${input.baseline.outputTokensPerCall.toLocaleString()} 토큰`,
      `호출당 ${input.baseline.secondsPerCall}초, 순차 실행`,
      `${sceneCount}씬 × ${repeats}회 정본`,
      estimatedUsd === undefined
        ? `${input.generationModel} 의 요금을 몰라 금액을 낼 수 없습니다`
        : `${input.generationModel} 요금으로 환산`,
      `심판 호출 ${judgeCalls.toLocaleString()}회는 금액에서 제외 (시간에는 포함)`,
    ],
  };
}

export function withinCap(estimate: BudgetEstimate, maxRuns: number | undefined): boolean {
  return maxRuns === undefined || estimate.points * estimate.repeats <= maxRuns;
}
