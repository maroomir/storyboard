import { z } from 'zod';

import tuningData from './promptTuning.params.json';
import type { PromptConfig } from './types';

// 프롬프트마다 «얼마나 흔들리게 쓸지(temperature)»와 «한 번에 얼마나 낼지(maxTokens)»를 정한다.
// 값이 프롬프트 파일마다 흩어져 있으면 «검사류는 낮게, 창작류는 높게» 같은 결이 유지되는지 한눈에
// 볼 수 없고, 분량 조정 때 파일을 서른 개 넘게 열어야 한다.
// 모델을 가리지 않는 값이다. 한 모델에서만 관찰한 값은 modelProfiles.params.json 에 적는다.
const promptConfigSchema = z.object({
  temperature: z.number().min(0).max(2),
  maxTokens: z.number().int().positive(),
});

const promptTuningSchema = z.record(z.string(), promptConfigSchema);

export type PromptTuningKey = keyof typeof tuningData;

const promptTuningTable = promptTuningSchema.parse(tuningData);

export type PromptTuningOverrides = Readonly<Partial<Record<string, Partial<PromptConfig>>>>;

// NOTE: 측정 하니스 전용 덮개. 프롬프트 모듈 서른다섯 곳이 import 시점에 config 를 한 번 붙잡으므로,
// 값을 호출마다 인자로 흘리려면 그 서른다섯 곳과 그것을 쓰는 서비스 전부를 고쳐야 한다. 대신
// promptTuning 이 돌려주는 객체를 살아 있는 읽기로 만들어, 나중에 덮어도 이미 붙잡힌 config 가
// 따라오게 한다. 제품 경로는 이 함수를 부르지 않으므로 기본값 그대로다.
let promptTuningOverrides: PromptTuningOverrides = {};

export function applyPromptTuningOverrides(overrides: PromptTuningOverrides): void {
  promptTuningOverrides = overrides;
}

export function resetPromptTuningOverrides(): void {
  promptTuningOverrides = {};
}

export function promptTuningKeys(): readonly PromptTuningKey[] {
  return Object.keys(promptTuningTable) as readonly PromptTuningKey[];
}

export function promptTuning(key: PromptTuningKey): PromptConfig {
  const config = promptTuningTable[key];

  if (config === undefined) {
    throw new Error(`프롬프트 튜닝 값이 없습니다: ${key}`);
  }

  return {
    get temperature(): number {
      return promptTuningOverrides[key]?.temperature ?? config.temperature;
    },
    get maxTokens(): number {
      return promptTuningOverrides[key]?.maxTokens ?? config.maxTokens;
    },
  };
}
