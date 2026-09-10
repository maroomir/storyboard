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

export function promptTuning(key: PromptTuningKey): PromptConfig {
  const config = promptTuningTable[key];

  if (config === undefined) {
    throw new Error(`프롬프트 튜닝 값이 없습니다: ${key}`);
  }

  return config;
}
