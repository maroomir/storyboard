import { aiProviderIds, aiTaskNames, type AiProviderId, type AiTaskName } from "../ai/types"

export interface ProviderModelConfig {
  readonly model?: string
  readonly baseUrl?: string
}

export interface TaskProviderConfig {
  readonly provider?: AiProviderId
}

export interface StoryboardConfigurationLike {
  readonly get: <T>(section: string, defaultValue: T) => T
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
    const configuredProvider = this.dependencies
      .getConfiguration()
      .get(`tasks.${taskName}.provider`, undefined as string | undefined)

    if (configuredProvider && isConfiguredProvider(configuredProvider)) {
      return configuredProvider
    }

    return this.getDefaultProvider()
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
