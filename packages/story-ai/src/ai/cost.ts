import { type ModelPricePerMillion, storyboardModelPricing } from '@storyboard/story-model';

import type { AiGenerateResponse, AiProviderId, AiUsage } from '@storyboard/story-model';

export function aiGenerateResponseWithUsage(params: {
  readonly providerId: AiProviderId;
  readonly model: string;
  readonly text: string;
  readonly usage?: AiUsage;
  readonly isTruncated?: boolean;
}): AiGenerateResponse {
  const { providerId, model, text, usage, isTruncated } = params;
  const truncation: { readonly isTruncated?: true } = isTruncated === true ? { isTruncated } : {};

  if (!usage) {
    return { providerId, model, text, ...truncation };
  }

  const costUsd: number | undefined = computeCostUsd({ providerId, model, usage });

  return {
    providerId,
    model,
    text,
    usage,
    ...(costUsd === undefined ? {} : { costUsd }),
    ...truncation,
  };
}

export function computeCostUsd(params: {
  readonly providerId: AiProviderId;
  readonly model: string | undefined;
  readonly usage: AiUsage | undefined;
}): number | undefined {
  if (!params.usage || !params.model) {
    return undefined;
  }

  const table: Readonly<Record<string, ModelPricePerMillion>> = storyboardModelPricing[
    params.providerId
  ] as Readonly<Record<string, ModelPricePerMillion>>;
  const row: ModelPricePerMillion | undefined = table[params.model];
  if (!row) {
    return undefined;
  }

  const inputMillions: number = params.usage.inputTokens / 1_000_000;
  const outputMillions: number = params.usage.outputTokens / 1_000_000;
  const cacheWriteMillions: number = (params.usage.cacheCreationInputTokens ?? 0) / 1_000_000;
  const cacheReadMillions: number = (params.usage.cacheReadInputTokens ?? 0) / 1_000_000;

  return (
    inputMillions * row.inputPricePerMillion +
    outputMillions * row.outputPricePerMillion +
    cacheWriteMillions * (row.cacheWritePricePerMillion ?? row.inputPricePerMillion) +
    cacheReadMillions * (row.cacheReadPricePerMillion ?? row.inputPricePerMillion)
  );
}
