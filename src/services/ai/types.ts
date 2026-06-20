export const aiProviderIds = ["openai", "claude", "google", "ollama", "mock"] as const

export type AiProviderId = (typeof aiProviderIds)[number]

export const aiTaskCatalog = [
  { name: "situationExtraction", label: "상황 추출", status: "wired" },
  { name: "personaGeneration", label: "페르소나 생성", status: "wired" },
  { name: "personaDialogue", label: "페르소나 대화", status: "wired" },
  { name: "sceneDraft", label: "씬 드래프트", status: "wired" },
  { name: "traitsExtraction", label: "특성 추출", status: "wired" },
  { name: "factExtraction", label: "설정 사실 추출", status: "wired" },
  { name: "grammarCheck", label: "문법 검사", status: "wired" },
  { name: "continuityCheck", label: "연속성 검사", status: "wired" },
  { name: "inlineCompletion", label: "인라인 완성", status: "wired" },
  { name: "draftExpansion", label: "드래프트 확장", status: "wired" },
  { name: "outlineSynopsis", label: "시놉시스 생성", status: "wired" },
  { name: "chapterPlan", label: "챕터 구성", status: "wired" },
  { name: "draftCritique", label: "초안 비평", status: "wired" },
  { name: "draftRevision", label: "초안 수정", status: "wired" },
  { name: "chapterSummary", label: "장 요약", status: "wired" }
] as const

export type AiTaskCatalogEntry = (typeof aiTaskCatalog)[number]
export type AiTaskName = AiTaskCatalogEntry["name"]
export type AiTaskStatus = AiTaskCatalogEntry["status"]
export type WiredAiTaskName = Extract<AiTaskCatalogEntry, { readonly status: "wired" }>["name"]

export const aiTaskNames = aiTaskCatalog.map((task) => task.name) as unknown as readonly [
  AiTaskName,
  ...AiTaskName[]
]

export const aiTaskLabels = Object.fromEntries(aiTaskCatalog.map((task) => [task.name, task.label])) as Readonly<
  Record<AiTaskName, string>
>

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

export type AiStreamChunk =
  | {
      readonly type: "text-delta"
      readonly delta: string
    }
  | {
      readonly type: "done"
      readonly response: AiGenerateResponse
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
  readonly generateStream?: (request: AiGenerateRequest) => AsyncIterable<AiStreamChunk>
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
