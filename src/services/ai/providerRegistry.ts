import { AiProviderError } from "./AiProviderError"
import { MockAiProvider } from "./providers/MockAiProvider"
import { OpenAiProvider, type OpenAiClientLike } from "./providers/OpenAiProvider"
import {
  aiProviderIds,
  type AiGenerateRequest,
  type AiGenerateResponse,
  type AiProvider,
  type AiProviderId,
  type AiProviderStatus
} from "./types"
import { SecretStore } from "../secrets/SecretStore"
import { ConfigBridge } from "../settings/ConfigBridge"

export interface AiProviderRegistryOptions {
  readonly secretStore: SecretStore
  readonly configBridge: ConfigBridge
  readonly createOpenAiClient?: (apiKey: string) => OpenAiClientLike
}

export class AiProviderRegistry {
  public constructor(private readonly options: AiProviderRegistryOptions) {}

  public async listProviders(): Promise<AiProviderStatus[]> {
    return Promise.all(aiProviderIds.map((providerId) => this.getProviderStatus(providerId)))
  }

  public async checkConnection(providerId: AiProviderId): Promise<boolean> {
    return (await this.createProvider(providerId)).checkConnection()
  }

  public async generate(request: AiGenerateRequest): Promise<AiGenerateResponse> {
    return this.generateWithProvider(this.options.configBridge.getTaskProvider(request.taskName), request)
  }

  public async generateWithProvider(
    providerId: AiProviderId,
    request: AiGenerateRequest
  ): Promise<AiGenerateResponse> {
    return (await this.createProvider(providerId)).generate(request)
  }

  private async createProvider(providerId: AiProviderId): Promise<AiProvider> {
    if (providerId === "mock") {
      return new MockAiProvider()
    }

    if (providerId === "openai") {
      return new OpenAiProvider({
        apiKey: await this.options.secretStore.getApiKey(providerId),
        model: this.options.configBridge.getProviderConfig(providerId).model,
        createClient: this.options.createOpenAiClient
      })
    }

    throw new AiProviderError(
      "provider-not-registered",
      providerId,
      `${providerId} provider는 아직 PR-3b에서 등록되지 않았습니다.`
    )
  }

  private async getProviderStatus(providerId: AiProviderId): Promise<AiProviderStatus> {
    const config = this.options.configBridge.getProviderConfig(providerId)
    const hasApiKey = providerId === "mock" ? true : await this.options.secretStore.hasApiKey(providerId)

    return {
      providerId,
      displayName: getProviderDisplayName(providerId),
      model: config.model,
      hasApiKey,
      isAvailable: providerId === "mock" || providerId === "openai"
    }
  }
}

export function createAiProviderRegistry(options: AiProviderRegistryOptions): AiProviderRegistry {
  return new AiProviderRegistry(options)
}

function getProviderDisplayName(providerId: AiProviderId): string {
  switch (providerId) {
    case "openai":
      return "OpenAI"
    case "claude":
      return "Claude"
    case "google":
      return "Google Gemini"
    case "ollama":
      return "Ollama"
    case "mock":
      return "Mock AI"
  }
}
