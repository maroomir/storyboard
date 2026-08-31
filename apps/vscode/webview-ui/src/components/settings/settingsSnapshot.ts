export const AI_PROVIDER_IDS = ["openai", "claude", "google", "ollama", "claude-code", "codex", "mock"] as const
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number]
export type AiTaskName = string
type AiTaskStatus = "wired" | "planned"

export type ConnectionTestState = "idle" | "loading" | "ok" | "error" | "not-installed"

export interface AiProviderStatus {
  readonly providerId: AiProviderId
  readonly displayName: string
  readonly model?: string
  readonly hasApiKey: boolean
  readonly isAvailable: boolean
}

interface ProviderModelOption {
  readonly id: string
  readonly displayName: string
}

interface ProviderRuntimeConfig {
  readonly model: string
  readonly baseUrl?: string
  readonly command?: string
}

interface TaskAiAssignment {
  readonly providerId: AiProviderId | null
  readonly model: string | null
}

export interface TaskCatalogItem {
  readonly name: AiTaskName
  readonly label: string
  readonly status: AiTaskStatus
}

export interface SettingsReadSnapshot {
  readonly defaultProvider: AiProviderId
  readonly providers: readonly AiProviderStatus[]
  readonly providerConfigs: Readonly<Record<AiProviderId, ProviderRuntimeConfig>>
  readonly taskAssignments: Readonly<Record<string, TaskAiAssignment>>
  readonly modelCatalog: Readonly<Record<AiProviderId, readonly ProviderModelOption[]>>
  readonly taskCatalog: readonly TaskCatalogItem[]
}

export function isAiProviderId(value: string): value is AiProviderId {
  return (AI_PROVIDER_IDS as readonly string[]).includes(value)
}

export function parseSettingsReadSnapshot(value: unknown): SettingsReadSnapshot | undefined {
  if (!value || typeof value !== "object") {
    return undefined
  }

  const candidate = value as Partial<SettingsReadSnapshot>
  if (!isAiProviderId(candidate.defaultProvider ?? "")) {
    return undefined
  }

  if (
    !Array.isArray(candidate.providers) ||
    !candidate.providerConfigs ||
    !candidate.taskAssignments ||
    !candidate.modelCatalog ||
    !Array.isArray(candidate.taskCatalog)
  ) {
    return undefined
  }

  for (const id of AI_PROVIDER_IDS) {
    const cfg = (candidate.providerConfigs as Record<string, unknown>)[id]
    if (!cfg || typeof cfg !== "object" || typeof (cfg as { model?: unknown }).model !== "string") {
      return undefined
    }
    const models = (candidate.modelCatalog as Record<string, unknown>)[id]
    if (!Array.isArray(models) || models.length === 0) {
      return undefined
    }
  }

  for (const taskEntry of candidate.taskCatalog) {
    if (!taskEntry || typeof taskEntry !== "object") {
      return undefined
    }

    const task = taskEntry as Record<string, unknown>
    if (typeof task.name !== "string" || task.name.trim().length === 0) {
      return undefined
    }
    if (typeof task.label !== "string" || task.label.trim().length === 0) {
      return undefined
    }
    if (task.status !== "wired" && task.status !== "planned") {
      return undefined
    }

    const taskName = task.name
    const assignment = (candidate.taskAssignments as Record<string, unknown>)[taskName]
    if (!assignment || typeof assignment !== "object") {
      return undefined
    }

    const row = assignment as Record<string, unknown>
    if (!("providerId" in row) || !("model" in row)) {
      return undefined
    }

    const providerId = row.providerId
    const model = row.model
    const usesDefaultProvider = providerId === null || providerId === undefined

    if (!usesDefaultProvider) {
      if (typeof providerId !== "string" || !isAiProviderId(providerId)) {
        return undefined
      }
    }

    if (model !== null && model !== undefined && typeof model !== "string") {
      return undefined
    }

    if (usesDefaultProvider && model !== null && model !== undefined) {
      return undefined
    }
  }

  return candidate as SettingsReadSnapshot
}

export function requiresApiKey(providerId: AiProviderId): boolean {
  return providerId !== "mock" && providerId !== "ollama" && providerId !== "claude-code" && providerId !== "codex"
}

export function hasTaskOverride(snapshot: SettingsReadSnapshot, taskName: AiTaskName): boolean {
  const assignment = snapshot.taskAssignments[taskName]
  return assignment !== undefined && assignment.providerId !== null
}

export function getProviderStatus(
  snapshot: SettingsReadSnapshot,
  providerId: AiProviderId
): AiProviderStatus | undefined {
  return snapshot.providers.find((entry) => entry.providerId === providerId)
}

export function pickModelForTaskProvider(
  snapshot: SettingsReadSnapshot,
  providerId: AiProviderId,
  preferredModelId: string | null
): string {
  const catalog = snapshot.modelCatalog[providerId]
  if (preferredModelId !== null && catalog.some((entry) => entry.id === preferredModelId)) {
    return preferredModelId
  }

  const globalModel = snapshot.providerConfigs[providerId].model
  if (catalog.some((entry) => entry.id === globalModel)) {
    return globalModel
  }

  return catalog[0]?.id ?? globalModel
}

export function formatResolvedTaskAi(snapshot: SettingsReadSnapshot, taskName: AiTaskName): string {
  const assign = snapshot.taskAssignments[taskName]
  let providerId: AiProviderId
  let modelId: string

  if (!assign || assign.providerId === null) {
    providerId = snapshot.defaultProvider
    modelId = snapshot.providerConfigs[providerId].model
  } else {
    providerId = assign.providerId
    modelId = assign.model ?? snapshot.providerConfigs[providerId].model
  }

  const providerName = getProviderStatus(snapshot, providerId)?.displayName ?? providerId
  const modelLabel =
    snapshot.modelCatalog[providerId].find((entry) => entry.id === modelId)?.displayName ?? modelId

  return `${providerName} / ${modelLabel}`
}

export function formatDefaultProviderSummary(snapshot: SettingsReadSnapshot): string {
  const providerId = snapshot.defaultProvider
  const providerName = getProviderStatus(snapshot, providerId)?.displayName ?? providerId
  const modelId = snapshot.providerConfigs[providerId].model
  const modelName = snapshot.modelCatalog[providerId].find((entry) => entry.id === modelId)?.displayName ?? modelId

  return `${providerName} · ${modelName}`
}
