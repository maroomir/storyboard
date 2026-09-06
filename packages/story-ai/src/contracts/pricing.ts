import type { AiProviderId } from './ai';

export interface ModelPricePerMillion {
  readonly inputPricePerMillion: number;
  readonly outputPricePerMillion: number;
}

export const storyboardModelPricing = {
  openai: {
    'gpt-5.4-mini': { inputPricePerMillion: 0.25, outputPricePerMillion: 2.0 },
    'gpt-5-mini': { inputPricePerMillion: 0.15, outputPricePerMillion: 0.6 },
    'gpt-5-nano': { inputPricePerMillion: 0.05, outputPricePerMillion: 0.2 },
  },
  claude: {
    'claude-sonnet-4-6': { inputPricePerMillion: 3.0, outputPricePerMillion: 15.0 },
    'claude-sonnet-4-5': { inputPricePerMillion: 3.0, outputPricePerMillion: 15.0 },
    'claude-haiku-4-5': { inputPricePerMillion: 1.0, outputPricePerMillion: 5.0 },
  },
  google: {
    'gemini-2.5-flash': { inputPricePerMillion: 0.075, outputPricePerMillion: 0.3 },
    'gemini-2.5-pro': { inputPricePerMillion: 1.25, outputPricePerMillion: 10.0 },
    'gemini-2.5-flash-lite': { inputPricePerMillion: 0.05, outputPricePerMillion: 0.2 },
  },
  grok: {
    // docs.x.ai/docs/models 2026-09 기준, 프롬프트 200k 토큰 미만 요금.
    'grok-4.6': { inputPricePerMillion: 2.0, outputPricePerMillion: 6.0 },
    'grok-4.5': { inputPricePerMillion: 2.0, outputPricePerMillion: 6.0 },
    'grok-4.3': { inputPricePerMillion: 1.25, outputPricePerMillion: 2.5 },
  },
  ollama: {
    'llama3.3': { inputPricePerMillion: 0, outputPricePerMillion: 0 },
    'llama3.2': { inputPricePerMillion: 0, outputPricePerMillion: 0 },
    'qwen2.5': { inputPricePerMillion: 0, outputPricePerMillion: 0 },
  },
  'claude-code': {},
  codex: {
    // Codex CLI는 ChatGPT 구독으로 인증돼 토큰당 과금이 아니므로 사용량만 기록한다.
  },
  'gemini-cli': {
    // Gemini CLI는 Google 계정 로그인 한도로 동작해 토큰당 과금이 아니므로 사용량만 기록한다.
  },
  mock: {
    'mock-default': { inputPricePerMillion: 0, outputPricePerMillion: 0 },
  },
} as const satisfies Record<AiProviderId, Record<string, ModelPricePerMillion>>;

// A subscription CLI authenticates with a plan, not a per-token bill, so its usage has tokens but
// no dollars. Summing its cost as 0 alongside a priced provider would understate the real charge
// while still looking like an exact figure, so callers that report money ask this first.
export function isUnpricedProvider(providerId: AiProviderId): boolean {
  return Object.keys(storyboardModelPricing[providerId]).length === 0;
}
