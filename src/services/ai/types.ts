export const aiProviderIds = ["openai", "claude", "google", "ollama", "mock"] as const

export type AiProviderId = (typeof aiProviderIds)[number]

export const aiTaskNames = [
  "situationExtraction",
  "personaDialogue",
  "sceneDraft",
  "traitsExtraction",
  "grammarCheck",
  "inlineCompletion",
  "draftExpansion"
] as const

export type AiTaskName = (typeof aiTaskNames)[number]

export type AiMessageRole = "system" | "user" | "assistant"

export interface AiMessage {
  readonly role: AiMessageRole
  readonly content: string
}

export interface AiGenerateRequest {
  readonly taskName: AiTaskName
  readonly messages: readonly AiMessage[]
  readonly temperature?: number
  readonly maxTokens?: number
}

export interface AiUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadInputTokens?: number
  readonly cacheCreationInputTokens?: number
}

export interface AiGenerateResponse {
  readonly text: string
  readonly providerId: AiProviderId
  readonly model?: string
  readonly usage?: AiUsage
  readonly costUsd?: number
}

export interface AiProviderStatus {
  readonly providerId: AiProviderId
  readonly displayName: string
  readonly model?: string
  readonly hasApiKey: boolean
  readonly isAvailable: boolean
}

export interface AiProvider {
  readonly id: AiProviderId
  readonly displayName: string
  readonly checkConnection: () => Promise<boolean>
  readonly generate: (request: AiGenerateRequest) => Promise<AiGenerateResponse>
}

export function isAiProviderId(value: string): value is AiProviderId {
  return aiProviderIds.includes(value as AiProviderId)
}
