export const aiProviderIds = ["openai", "claude", "google", "ollama", "mock"] as const

export type AiProviderId = (typeof aiProviderIds)[number]

export const aiTaskNames = [
  "situationExtraction",
  "personaDialogue",
  "sceneDraft",
  "grammarCheck",
  "inlineCompletion",
  "draftExpansion"
] as const

export type AiTaskName = (typeof aiTaskNames)[number]

export function isAiProviderId(value: string): value is AiProviderId {
  return aiProviderIds.includes(value as AiProviderId)
}
