import { aiProviderIds, aiTaskNames, type AiProviderId, type AiTaskName } from "../ai/types"

const storyboardWorkspaceConfigurationTarget = 2

export interface ProviderModelConfig {
  readonly model?: string
  readonly baseUrl?: string
}

export interface TaskProviderConfig {
  readonly provider?: AiProviderId
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

    return {
      model: configuration.get(`providers.${providerId}.model`, getDefaultModel(providerId))
    }
  }

  public getTaskProvider(taskName: AiTaskName): AiProviderId {
    const override = this.getTaskProviderOverride(taskName)

    if (override !== null) {
      return override
    }

    return this.getDefaultProvider()
  }

  public getTaskProviderOverride(taskName: AiTaskName): AiProviderId | null {
    const merged = this.readTasksOverrides(this.dependencies.getConfiguration())
    return merged[taskName]?.provider ?? null
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

  public async setTaskProvider(taskName: AiTaskName, providerId: AiProviderId | null): Promise<void> {
    if (providerId === null) {
      await this.clearTaskProvider(taskName)
      return
    }

    const configuration = this.dependencies.getConfiguration()
    this.assertConfigurationUpdate(configuration)

    const merged = this.readTasksOverrides(configuration)
    merged[taskName] = { provider: providerId }
    await configuration.update("tasks", merged, storyboardWorkspaceConfigurationTarget)
  }

  public async clearTaskProvider(taskName: AiTaskName): Promise<void> {
    const configuration = this.dependencies.getConfiguration()
    this.assertConfigurationUpdate(configuration)

    const merged = this.readTasksOverrides(configuration)
    delete merged[taskName]
    await configuration.update("tasks", merged, storyboardWorkspaceConfigurationTarget)
  }

  public isGrammarRealtimeEnabled(): boolean {
    return this.dependencies.getConfiguration().get("grammar.realtimeEnabled", false)
  }

  public getScenePrefixDigits(): number {
    return this.dependencies.getConfiguration().get("scene.prefixDigits", 2)
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

  private readTasksOverrides(
    configuration: StoryboardConfigurationLike
  ): Record<string, { readonly provider: AiProviderId }> {
    const merged: Record<string, { readonly provider: AiProviderId }> = {}
    const fromTasksObject = configuration.get("tasks", {}) as Record<string, { provider?: string } | undefined>

    for (const taskName of aiTaskNames) {
      const fromNested = fromTasksObject[taskName]?.provider
      const fromDot = configuration.get(`tasks.${taskName}.provider`, undefined as string | undefined)
      const raw = fromNested ?? fromDot

      if (raw && isConfiguredProvider(raw)) {
        merged[taskName] = { provider: raw }
      }
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
    case "mock":
    case "ollama":
      return undefined
  }
}

export function getConfigurableTaskNames(): readonly AiTaskName[] {
  return aiTaskNames
}
