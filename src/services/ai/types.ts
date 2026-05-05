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

export type EntityKind = "scene" | "character" | "background"

export interface EntityRef {
  readonly kind: EntityKind
  readonly id: string
}

export interface UsageAttribution {
  readonly primary?: EntityRef
  readonly participants?: readonly EntityRef[]
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

export interface UsageRecord {
  readonly recordId?: string
  readonly taskName: AiTaskName
  readonly providerId: AiProviderId
  readonly model?: string
  readonly usage?: AiUsage
  readonly costUsd: number
  readonly attribution: UsageAttribution
}

export interface UsageSummaryByEntity {
  readonly scenes: Readonly<Record<string, number>>
  readonly characters: Readonly<Record<string, number>>
  readonly backgrounds: Readonly<Record<string, number>>
  readonly totalUsd: number
}

export function isAiProviderId(value: string): value is AiProviderId {
  return aiProviderIds.includes(value as AiProviderId)
}
