import { aiProviderIds, aiTaskNames, type AiProviderId, type AiTaskName } from "../ai/types"
import { storyboardModelCatalog } from "@/shared/models"

const storyboardWorkspaceConfigurationTarget = 2

export interface ProviderModelConfig {
  readonly model?: string
  readonly baseUrl?: string
  readonly command?: string
}

export interface TaskAiStoredEntry {
  readonly provider: AiProviderId
  readonly model?: string
}

export interface TaskAiConfigOverride {
  readonly providerId: AiProviderId
  readonly model: string | null
}

export interface TaskAiConfigResolved {
  readonly providerId: AiProviderId
  readonly model: string
}

export interface StoryboardConfigurationLike {
  readonly get: <T>(section: string, defaultValue: T) => T
  readonly update?: <T>(
    section: string,
    value: T,
    configurationTarget?: number
  ) => Thenable<void>
}

export interface StoryboardConfigurationChangeEventLike {
  readonly affectsConfiguration: (section: string) => boolean
}

export interface ConfigBridgeDependencies {
  readonly getConfiguration: () => StoryboardConfigurationLike
  readonly onDidChangeConfiguration?: (
    listener: (event: StoryboardConfigurationChangeEventLike) => void
  ) => { readonly dispose: () => void }
}

export class ConfigBridge {
  public constructor(private readonly dependencies: ConfigBridgeDependencies) {}

  public getDefaultProvider(): AiProviderId {
    return this.getProviderId("defaultProvider", "mock")
  }

  public getProviderConfig(providerId: AiProviderId): ProviderModelConfig {
    const configuration = this.dependencies.getConfiguration()

    if (providerId === "ollama") {
      return {
        baseUrl: configuration.get("providers.ollama.baseUrl", "http://localhost:11434"),
        model: configuration.get("providers.ollama.model", "llama3.3")
      }
    }

    if (providerId === "claude-code" || providerId === "codex") {
      return {
        command: configuration.get(`providers.${providerId}.command`, getDefaultCommand(providerId)),
        model: configuration.get(`providers.${providerId}.model`, getDefaultModel(providerId))
      }
    }

    return {
      model: configuration.get(`providers.${providerId}.model`, getDefaultModel(providerId))
    }
  }

  public getTaskProvider(taskName: AiTaskName): AiProviderId {
    return this.getTaskAiConfig(taskName).providerId
  }

  public getTaskProviderOverride(taskName: AiTaskName): AiProviderId | null {
    const entry = this.getTaskAiConfigOverride(taskName)
    return entry?.providerId ?? null
  }

  public getTaskAiConfigOverride(taskName: AiTaskName): TaskAiConfigOverride | null {
    const stored = this.readTaskStoredEntry(this.dependencies.getConfiguration(), taskName)
    if (!stored) {
      return null
    }

    return { providerId: stored.provider, model: stored.model ?? null }
  }

  public getTaskAiConfig(taskName: AiTaskName): TaskAiConfigResolved {
    const stored = this.readTaskStoredEntry(this.dependencies.getConfiguration(), taskName)
    const defaultProvider = this.getDefaultProvider()
    const providerId = stored?.provider ?? defaultProvider
    const runtime = this.getProviderConfig(providerId)
    const catalog = storyboardModelCatalog[providerId]
    const fallbackModelId = catalog[0].id

    const taskModel =
      stored?.model !== undefined && isModelInCatalogForProvider(providerId, stored.model)
        ? stored.model
        : undefined

    const model =
      taskModel ?? resolveEffectiveModelForTask(runtime.model, fallbackModelId, providerId)

    return { providerId, model }
  }

  public async setDefaultProvider(providerId: AiProviderId): Promise<void> {
    await this.configurationUpdate("defaultProvider", providerId)
  }

  public async setProviderModel(providerId: AiProviderId, model: string): Promise<void> {
    await this.configurationUpdate(`providers.${providerId}.model`, model)
  }

  public async setProviderBaseUrl(baseUrl: string): Promise<void> {
    await this.configurationUpdate("providers.ollama.baseUrl", baseUrl)
  }

  public async setTaskAiConfig(
    taskName: AiTaskName,
    config: { readonly providerId: AiProviderId | null; readonly model: string | null }
  ): Promise<void> {
    const configuration = this.dependencies.getConfiguration()
    this.assertConfigurationUpdate(configuration)

    if (config.providerId === null) {
      await this.clearTaskAiConfig(taskName)
      return
    }

    if (config.model === null) {
      throw new Error("setTaskAiConfig: model is required when providerId is set.")
    }

    if (!isModelInCatalogForProvider(config.providerId, config.model)) {
      throw new Error(`setTaskAiConfig: model is not allowed for provider ${config.providerId}.`)
    }

    const merged = this.readTasksPersistMap(configuration)
    merged[taskName] = { provider: config.providerId, model: config.model }
    await configuration.update("tasks", merged, storyboardWorkspaceConfigurationTarget)
  }

  public async clearTaskAiConfig(taskName: AiTaskName): Promise<void> {
    const configuration = this.dependencies.getConfiguration()
    this.assertConfigurationUpdate(configuration)

    const merged = this.readTasksPersistMap(configuration)
    delete merged[taskName]
    await configuration.update("tasks", merged, storyboardWorkspaceConfigurationTarget)
  }

  public isGrammarRealtimeEnabled(): boolean {
    return this.dependencies.getConfiguration().get("grammar.realtimeEnabled", false)
  }

  public getScenePrefixDigits(): number {
    return this.dependencies.getConfiguration().get("scene.prefixDigits", 2)
  }

  public isAiContextCondenseEnabled(): boolean {
    return this.dependencies.getConfiguration().get("ai.contextCondenseEnabled", false)
  }

  public onDidChange(listener: () => void): { readonly dispose: () => void } {
    if (!this.dependencies.onDidChangeConfiguration) {
      return { dispose: (): void => undefined }
    }

    return this.dependencies.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("storyboard")) {
        listener()
      }
    })
  }

  private getProviderId(section: string, fallback: AiProviderId): AiProviderId {
    const configuredProvider = this.dependencies.getConfiguration().get(section, fallback as string)

    return isConfiguredProvider(configuredProvider) ? configuredProvider : fallback
  }

  private readTaskStoredEntry(
    configuration: StoryboardConfigurationLike,
    taskName: AiTaskName
  ): TaskAiStoredEntry | undefined {
    const fromTasksObject = configuration.get("tasks", {}) as Record<
      string,
      { provider?: string; model?: string } | undefined
    >

    const nested = fromTasksObject[taskName]
    const fromDotProvider = configuration.get(`tasks.${taskName}.provider`, undefined as string | undefined)
    const fromDotModel = configuration.get(`tasks.${taskName}.model`, undefined as string | undefined)
    const rawProvider = nested?.provider ?? fromDotProvider
    const rawModel = nested?.model ?? fromDotModel

    if (!rawProvider || !isConfiguredProvider(rawProvider)) {
      return undefined
    }

    const trimmedModel = typeof rawModel === "string" ? rawModel.trim() : ""

    if (trimmedModel.length > 0 && isModelInCatalogForProvider(rawProvider, trimmedModel)) {
      return { provider: rawProvider, model: trimmedModel }
    }

    return { provider: rawProvider }
  }

  private readTasksPersistMap(
    configuration: StoryboardConfigurationLike
  ): Record<string, { readonly provider: AiProviderId; readonly model?: string }> {
    const merged: Record<string, { readonly provider: AiProviderId; readonly model?: string }> = {}

    for (const taskName of aiTaskNames) {
      const stored = this.readTaskStoredEntry(configuration, taskName)
      if (!stored) {
        continue
      }

      merged[taskName] =
        stored.model !== undefined ? { provider: stored.provider, model: stored.model } : { provider: stored.provider }
    }

    return merged
  }

  private assertConfigurationUpdate(configuration: StoryboardConfigurationLike): asserts configuration is StoryboardConfigurationLike & {
    readonly update: NonNullable<StoryboardConfigurationLike["update"]>
  } {
    if (!configuration.update) {
      throw new Error("StoryboardConfigurationLike.update is required to change Storyboard settings.")
    }
  }

  private async configurationUpdate<T>(section: string, value: T): Promise<void> {
    const configuration = this.dependencies.getConfiguration()
    this.assertConfigurationUpdate(configuration)
    await configuration.update(section, value, storyboardWorkspaceConfigurationTarget)
  }
}

function isModelInCatalogForProvider(providerId: AiProviderId, modelId: string): boolean {
  return storyboardModelCatalog[providerId].some((entry) => entry.id === modelId)
}

function resolveEffectiveModelForTask(
  configuredGlobal: string | undefined,
  fallbackModelId: string,
  providerId: AiProviderId
): string {
  const trimmed = configuredGlobal?.trim()

  if (trimmed !== undefined && trimmed.length > 0 && isModelInCatalogForProvider(providerId, trimmed)) {
    return trimmed
  }

  return fallbackModelId
}

function isConfiguredProvider(value: string): value is AiProviderId {
  return aiProviderIds.includes(value as AiProviderId)
}

function getDefaultModel(providerId: AiProviderId): string | undefined {
  switch (providerId) {
    case "openai":
      return "gpt-5.4-mini"
    case "claude":
      return "claude-sonnet-4-6"
    case "google":
      return "gemini-2.5-flash"
    case "claude-code":
      return "sonnet"
    case "codex":
      return "gpt-5-codex"
    case "mock":
    case "ollama":
      return undefined
  }
}

function getDefaultCommand(providerId: "claude-code" | "codex"): string {
  return providerId === "claude-code" ? "claude" : "codex"
}

export function getConfigurableTaskNames(): readonly AiTaskName[] {
  return aiTaskNames
}
