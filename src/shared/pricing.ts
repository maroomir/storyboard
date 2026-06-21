import type { AiProviderId } from "../services/ai/types"

export interface ModelPricePerMillion {
  readonly inputPricePerMillion: number
  readonly outputPricePerMillion: number
}

export const storyboardModelPricing = {
  openai: {
    "gpt-5.4-mini": { inputPricePerMillion: 0.25, outputPricePerMillion: 2.0 },
    "gpt-5-mini": { inputPricePerMillion: 0.15, outputPricePerMillion: 0.6 },
    "gpt-5-nano": { inputPricePerMillion: 0.05, outputPricePerMillion: 0.2 }
  },
  claude: {
    "claude-sonnet-4-6": { inputPricePerMillion: 3.0, outputPricePerMillion: 15.0 },
    "claude-sonnet-4-5": { inputPricePerMillion: 3.0, outputPricePerMillion: 15.0 },
    "claude-haiku-4-5": { inputPricePerMillion: 1.0, outputPricePerMillion: 5.0 }
  },
  google: {
    "gemini-2.5-flash": { inputPricePerMillion: 0.075, outputPricePerMillion: 0.3 },
    "gemini-2.5-pro": { inputPricePerMillion: 1.25, outputPricePerMillion: 10.0 },
    "gemini-2.5-flash-lite": { inputPricePerMillion: 0.05, outputPricePerMillion: 0.2 }
  },
  ollama: {
    "llama3.3": { inputPricePerMillion: 0, outputPricePerMillion: 0 },
    "llama3.2": { inputPricePerMillion: 0, outputPricePerMillion: 0 },
    "qwen2.5": { inputPricePerMillion: 0, outputPricePerMillion: 0 }
  },
  "claude-code": {},
  codex: {
    // NOTE: gpt-5-codex API 요금(2025-09 기준 input $1.25 / output $10.00 per 1M)을 추정치로 쓴다.
    // Codex CLI는 ChatGPT 구독으로 인증돼 토큰당 과금이 아니므로 이 값은 실제 청구액이 아닌 환산 추정이다.
    "gpt-5-codex": { inputPricePerMillion: 1.25, outputPricePerMillion: 10.0 }
  },
  mock: {
    "mock-default": { inputPricePerMillion: 0, outputPricePerMillion: 0 }
  }
} as const satisfies Record<AiProviderId, Record<string, ModelPricePerMillion>>
