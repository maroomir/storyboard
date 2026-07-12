import { type ModelPricePerMillion, storyboardModelPricing } from '@/shared/pricing';

import type { AiGenerateResponse, AiProviderId, AiUsage } from './types';

export function aiGenerateResponseWithUsage(params: {
  readonly providerId: AiProviderId;
  readonly model: string;
  readonly text: string;
  readonly usage?: AiUsage;
}): AiGenerateResponse {
  const { providerId, model, text, usage } = params;
  if (!usage) {
    return { providerId, model, text };
  }

  return {
    providerId,
    model,
    text,
    usage,
    costUsd: computeCostUsd({ providerId, model, usage }),
  };
}

export function computeCostUsd(params: {
  readonly providerId: AiProviderId;
  readonly model: string | undefined;
  readonly usage: AiUsage | undefined;
}): number {
  if (!params.usage || !params.model) {
    return 0;
  }

  const table = storyboardModelPricing[params.providerId] as Readonly<
    Record<string, ModelPricePerMillion>
  >;
  const row = table[params.model];
  if (!row) {
    return 0;
  }

  const inputMillions = params.usage.inputTokens / 1_000_000;
  const outputMillions = params.usage.outputTokens / 1_000_000;

  return inputMillions * row.inputPricePerMillion + outputMillions * row.outputPricePerMillion;
}
