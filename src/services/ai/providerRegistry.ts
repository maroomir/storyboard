import { AiProviderError } from "./AiProviderError"
import { ClaudeProvider, type ClaudeClientLike } from "./providers/ClaudeProvider"
import { GoogleProvider, type GoogleClientLike } from "./providers/GoogleProvider"
import { MockAiProvider } from "./providers/MockAiProvider"
import { OllamaProvider, type OllamaClientLike } from "./providers/OllamaProvider"
import { OpenAiProvider, type OpenAiClientLike } from "./providers/OpenAiProvider"
import {
  aiProviderIds,
  type AiGenerateRequest,
  type AiGenerateResponse,
  type AiProvider,
  type AiProviderId,
  type AiProviderStatus,
  type AiTaskName
} from "./types"
import { SecretStore } from "../secrets/SecretStore"
import { ConfigBridge } from "../settings/ConfigBridge"

export interface AiProviderRegistryOptions {
  readonly secretStore: SecretStore
  readonly configBridge: ConfigBridge
  readonly createClaudeClient?: (apiKey: string) => ClaudeClientLike
  readonly createGoogleClient?: (apiKey: string) => GoogleClientLike
  readonly createOllamaClient?: (baseUrl: string) => OllamaClientLike
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
    return this.generateWithProvider(this.getTaskProvider(request.taskName), request)
  }

  public getTaskProvider(taskName: AiTaskName): AiProviderId {
    return this.options.configBridge.getTaskProvider(taskName)
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

    if (providerId === "claude") {
      return new ClaudeProvider({
        apiKey: await this.options.secretStore.getApiKey(providerId),
        model: this.options.configBridge.getProviderConfig(providerId).model,
        createClient: this.options.createClaudeClient
      })
    }

    if (providerId === "google") {
      return new GoogleProvider({
        apiKey: await this.options.secretStore.getApiKey(providerId),
        model: this.options.configBridge.getProviderConfig(providerId).model,
        createClient: this.options.createGoogleClient
      })
    }

    if (providerId === "ollama") {
      const config = this.options.configBridge.getProviderConfig(providerId)
      return new OllamaProvider({
        baseUrl: config.baseUrl,
        model: config.model,
        createClient: this.options.createOllamaClient
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
    const hasApiKey =
      providerId === "mock" || providerId === "ollama" ? true : await this.options.secretStore.hasApiKey(providerId)

    return {
      providerId,
      displayName: getProviderDisplayName(providerId),
      model: config.model,
      hasApiKey,
      isAvailable: true
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
