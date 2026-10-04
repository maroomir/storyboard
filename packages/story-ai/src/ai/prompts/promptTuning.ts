import type { ReasoningEffort } from '@storyboard/story-model';

import { promptResourceKeys, promptResources } from './promptResource';
import type { PromptConfig } from './types';

// 프롬프트마다 «얼마나 흔들리게 쓸지(temperature)»와 «한 번에 얼마나 낼지(maxTokens)»는 그
// 프롬프트의 리소스 파일 머리말에 있다. 이 모듈은 그 값을 읽는 창구이자 측정 하니스의 덮개다.
export type PromptTuningKey = string;

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
  return promptResourceKeys();
}

// The same live read also follows an author's prompt file laid over the bundled one.
export function promptTuning(key: PromptTuningKey): PromptConfig {
  promptResources.config(key);

  return {
    get temperature(): number {
      return promptTuningOverrides[key]?.temperature ?? promptResources.config(key).temperature;
    },
    get maxTokens(): number {
      return promptTuningOverrides[key]?.maxTokens ?? promptResources.config(key).maxTokens;
    },
    get reasoningEffort(): ReasoningEffort | undefined {
      return (
        promptTuningOverrides[key]?.reasoningEffort ?? promptResources.config(key).reasoningEffort
      );
    },
  };
}
