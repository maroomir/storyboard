import type { ReasoningEffort } from '@storyboard/story-model';

import { promptResourceKeys, promptResources } from './promptResource';
import type { PromptConfig } from './types';

export type PromptTuningKey = string;

export type PromptTuningOverrides = Readonly<Partial<Record<string, Partial<PromptConfig>>>>;

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
