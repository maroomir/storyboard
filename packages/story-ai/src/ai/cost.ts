import { type ModelPricePerMillion, storyboardModelPricing } from '#ai/contracts/providerCatalog';

import type { AiGenerateResponse, AiProviderId, AiUsage } from '#ai/contracts/aiTypes';

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

  const costUsd = computeCostUsd({ providerId, model, usage });

  return {
    providerId,
    model,
    text,
    usage,
    ...(costUsd === undefined ? {} : { costUsd }),
  };
}

// NOTE: `undefined` means "no price known" (subscription CLIs, unlisted models), which the ledger
// must keep apart from a genuinely free call — collapsing it to 0 is how every run read as $0.
export function computeCostUsd(params: {
  readonly providerId: AiProviderId;
  readonly model: string | undefined;
  readonly usage: AiUsage | undefined;
}): number | undefined {
  if (!params.usage || !params.model) {
    return undefined;
  }

  const table = storyboardModelPricing[params.providerId] as Readonly<
    Record<string, ModelPricePerMillion>
  >;
  const row = table[params.model];
  if (!row) {
    return undefined;
  }

  const inputMillions = params.usage.inputTokens / 1_000_000;
  const outputMillions = params.usage.outputTokens / 1_000_000;
  // NOTE: Claude 는 캐시에 쓰거나 캐시에서 읽은 토큰을 input_tokens 밖에서 따로 센다. 더하지 않으면
  // 캐시를 켠 실행이 실제보다 싸게 읽힌다. 캐시 요금이 없는 모델은 입력 요금으로 센다.
  const cacheWriteMillions = (params.usage.cacheCreationInputTokens ?? 0) / 1_000_000;
  const cacheReadMillions = (params.usage.cacheReadInputTokens ?? 0) / 1_000_000;

  return (
    inputMillions * row.inputPricePerMillion +
    outputMillions * row.outputPricePerMillion +
    cacheWriteMillions * (row.cacheWritePricePerMillion ?? row.inputPricePerMillion) +
    cacheReadMillions * (row.cacheReadPricePerMillion ?? row.inputPricePerMillion)
  );
}
