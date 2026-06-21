import { AiProviderError } from "./AiProviderError"
import { type CliRunner } from "./providers/cliRunner"
import { ClaudeCodeProvider } from "./providers/ClaudeCodeProvider"
import { ClaudeProvider, type ClaudeClientLike } from "./providers/ClaudeProvider"
import { CodexProvider } from "./providers/CodexProvider"
import { GoogleProvider, type GoogleClientLike } from "./providers/GoogleProvider"
import { MockAiProvider } from "./providers/MockAiProvider"
import { OllamaProvider, type OllamaClientLike } from "./providers/OllamaProvider"
import { OpenAiProvider, type OpenAiClientLike } from "./providers/OpenAiProvider"
import {
  type AiStreamChunk,
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
  readonly createCliRunner?: () => CliRunner
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
    const { providerId, model } = this.options.configBridge.getTaskAiConfig(request.taskName)
    return this.generateWithProvider(providerId, request, model)
  }

  public generateStream(request: AiGenerateRequest): AsyncIterable<AiStreamChunk> {
    const { providerId, model } = this.options.configBridge.getTaskAiConfig(request.taskName)
    return this.generateStreamWithProvider(providerId, request, model)
  }

  public getTaskProvider(taskName: AiTaskName): AiProviderId {
    return this.options.configBridge.getTaskProvider(taskName)
  }

  public getTaskAiConfig(taskName: AiTaskName): { readonly providerId: AiProviderId; readonly model: string } {
    return this.options.configBridge.getTaskAiConfig(taskName)
  }

  public async generateWithProvider(
    providerId: AiProviderId,
    request: AiGenerateRequest,
    modelOverride?: string
  ): Promise<AiGenerateResponse> {
    return (await this.createProvider(providerId, modelOverride)).generate(request)
  }

  public async *generateStreamWithProvider(
    providerId: AiProviderId,
    request: AiGenerateRequest,
    modelOverride?: string
  ): AsyncIterable<AiStreamChunk> {
    const provider = await this.createProvider(providerId, modelOverride)

    if (provider.generateStream) {
      yield* provider.generateStream(request)
      return
    }

    const response = await provider.generate(request)
    if (response.text.length > 0) {
      yield { type: "text-delta", delta: response.text }
    }
    yield { type: "done", response }
  }

  private async createProvider(providerId: AiProviderId, modelOverride?: string): Promise<AiProvider> {
    if (providerId === "mock") {
      return new MockAiProvider()
    }

    if (providerId === "openai") {
      const config = this.options.configBridge.getProviderConfig(providerId)
      return new OpenAiProvider({
        apiKey: await this.options.secretStore.getApiKey(providerId),
        model: modelOverride ?? config.model,
        createClient: this.options.createOpenAiClient
      })
    }

    if (providerId === "claude") {
      const config = this.options.configBridge.getProviderConfig(providerId)
      return new ClaudeProvider({
        apiKey: await this.options.secretStore.getApiKey(providerId),
        model: modelOverride ?? config.model,
        createClient: this.options.createClaudeClient
      })
    }

    if (providerId === "google") {
      const config = this.options.configBridge.getProviderConfig(providerId)
      return new GoogleProvider({
        apiKey: await this.options.secretStore.getApiKey(providerId),
        model: modelOverride ?? config.model,
        createClient: this.options.createGoogleClient
      })
    }

    if (providerId === "ollama") {
      const config = this.options.configBridge.getProviderConfig(providerId)
      return new OllamaProvider({
        baseUrl: config.baseUrl,
        model: modelOverride ?? config.model,
        createClient: this.options.createOllamaClient
      })
    }

    if (providerId === "claude-code") {
      const config = this.options.configBridge.getProviderConfig(providerId)
      return new ClaudeCodeProvider({
        command: config.command,
        model: modelOverride ?? config.model,
        createRunner: this.options.createCliRunner
      })
    }

    if (providerId === "codex") {
      const config = this.options.configBridge.getProviderConfig(providerId)
      return new CodexProvider({
        command: config.command,
        model: modelOverride ?? config.model,
        createRunner: this.options.createCliRunner
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
    const hasApiKey = isKeylessProvider(providerId) ? true : await this.options.secretStore.hasApiKey(providerId)

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

function isKeylessProvider(providerId: AiProviderId): boolean {
  return providerId === "mock" || providerId === "ollama" || providerId === "claude-code" || providerId === "codex"
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
    case "claude-code":
      return "Claude Code (CLI)"
    case "codex":
      return "Codex (CLI)"
    case "mock":
      return "Mock AI"
  }
}
