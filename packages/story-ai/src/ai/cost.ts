import { type ModelPricePerMillion, storyboardModelPricing } from '#ai/contracts/pricing';

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

  return inputMillions * row.inputPricePerMillion + outputMillions * row.outputPricePerMillion;
}
