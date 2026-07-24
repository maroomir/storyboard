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
  ollama: {
    'llama3.3': { inputPricePerMillion: 0, outputPricePerMillion: 0 },
    'llama3.2': { inputPricePerMillion: 0, outputPricePerMillion: 0 },
    'qwen2.5': { inputPricePerMillion: 0, outputPricePerMillion: 0 },
  },
  'claude-code': {},
  codex: {
    // Codex CLI는 ChatGPT 구독으로 인증돼 토큰당 과금이 아니므로 사용량만 기록한다.
  },
  mock: {
    'mock-default': { inputPricePerMillion: 0, outputPricePerMillion: 0 },
  },
} as const satisfies Record<AiProviderId, Record<string, ModelPricePerMillion>>;
