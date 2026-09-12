import { computeCostUsd } from '@storyboard/story-ai';
import type { AiProviderId } from '@storyboard/story-ai';

import { simDefaults } from '#sim/simDefaults';

// 실행 전에 «얼마나 드는지»를 숫자로 보여 주고 멈춘다. 승인 없이는 한 호출도 하지 않는다.
export interface BudgetEstimate {
  readonly points: number;
  readonly repeats: number;
  readonly generationCalls: number;
  readonly judgeCalls: number;
  readonly estimatedInputTokens: number;
  readonly estimatedOutputTokens: number;
  readonly estimatedUsd: number | undefined;
  readonly estimatedWallClockHours: number;
  // 견적이 어떤 실측에 기댔는지. 없으면 숫자를 믿을 근거가 없다.
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
  const repeats = input.repeats ?? simDefaults.run.repeats;
  const sceneCount = input.sceneCount ?? simDefaults.run.sceneCount;
  const runs = input.points * repeats;

  const generationCalls = Math.round(runs * sceneCount * input.baseline.generationCallsPerScene);
  const judgeCalls = runs * input.judgeCallsPerRun;

  const estimatedInputTokens = generationCalls * input.baseline.inputTokensPerCall;
  const estimatedOutputTokens = generationCalls * input.baseline.outputTokensPerCall;

  const estimatedUsd = computeCostUsd({
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
    // 심판 호출은 비용 축에서 빠지지만 시간은 똑같이 든다.
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
      // 심판 호출은 비용 축에서 빠지므로 위 금액에 들어 있지 않다.
      `심판 호출 ${judgeCalls.toLocaleString()}회는 금액에서 제외 (시간에는 포함)`,
    ],
  };
}

export function withinCap(estimate: BudgetEstimate, maxRuns: number | undefined): boolean {
  return maxRuns === undefined || estimate.points * estimate.repeats <= maxRuns;
}
