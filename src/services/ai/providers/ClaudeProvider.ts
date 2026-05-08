import Anthropic from "@anthropic-ai/sdk"
import { type MessageParam, type TextBlockParam } from "@anthropic-ai/sdk/resources/messages"

import { aiGenerateResponseWithUsage } from "../cost"
import { AiProviderError } from "../AiProviderError"
import {
  type AiGenerateRequest,
  type AiGenerateResponse,
  type AiMessage,
  type AiMessageRole,
  type AiProvider,
  type AiProviderId,
  type AiUsage
} from "../types"

type ClaudeMessageRole = Exclude<AiMessageRole, "system">

interface ClaudeConversationMessage {
  readonly role: ClaudeMessageRole
  readonly content: string
}

interface ClaudeMessagesLike {
  readonly create: (request: ClaudeMessageRequest) => Promise<ClaudeMessageResponse>
}

export interface ClaudeClientLike {
  readonly messages: ClaudeMessagesLike
}

export interface ClaudeProviderOptions {
  readonly apiKey: string | undefined
  readonly model: string | undefined
  readonly createClient?: (apiKey: string) => ClaudeClientLike
}

interface ClaudeMessageRequest {
  readonly model: string
  readonly max_tokens: number
  readonly temperature?: number
  readonly system?: string | ReadonlyArray<TextBlockParam>
  readonly messages: ReadonlyArray<ClaudeConversationMessage>
}

interface ClaudeMessageResponse {
  readonly content: ReadonlyArray<{
    readonly type: string
    readonly text?: string
  }>
  readonly usage?: {
    readonly input_tokens?: number
    readonly output_tokens?: number
    readonly cache_read_input_tokens?: number
    readonly cache_creation_input_tokens?: number
  }
}

export class ClaudeProvider implements AiProvider {
  public readonly id: AiProviderId = "claude"
  public readonly displayName = "Claude"
  private readonly client: ClaudeClientLike
  private readonly model: string

  public constructor(options: ClaudeProviderOptions) {
    const apiKey = options.apiKey?.trim()
    const model = options.model?.trim()

    if (!apiKey) {
      throw new AiProviderError("missing-api-key", this.id, "Claude API 키가 설정되어 있지 않습니다.")
    }

    if (!model) {
      throw new AiProviderError("missing-model", this.id, "Claude 모델이 설정되어 있지 않습니다.")
    }

    this.model = model
    this.client = options.createClient?.(apiKey) ?? createDefaultClaudeClient(apiKey)
  }

  public async checkConnection(): Promise<boolean> {
    try {
      await this.client.messages.create({
        model: this.model,
        max_tokens: 10,
        messages: [{ role: "user", content: "test" }]
      })

      return true
    } catch (error) {
      throw new AiProviderError("connection-failed", this.id, "Claude 연결 확인에 실패했습니다.", error)
    }
  }

  public async generate(request: AiGenerateRequest): Promise<AiGenerateResponse> {
    try {
      const { systemPrompt, messages } = splitClaudeMessages(request.messages)
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: request.maxTokens ?? 4096,
        temperature: request.temperature,
        ...(systemPrompt
          ? {
              system: [
                {
                  type: "text",
                  text: systemPrompt,
                  cache_control: { type: "ephemeral" }
                }
              ]
            }
          : {}),
        messages
      })

      const text = extractClaudeText(response)
      const usage = usageFromClaudeResponse(response)
      return aiGenerateResponseWithUsage({ providerId: this.id, model: this.model, text, usage })
    } catch (error) {
      throw new AiProviderError("generation-failed", this.id, "Claude 텍스트 생성에 실패했습니다.", error)
    }
  }
}

function splitClaudeMessages(messages: readonly AiMessage[]): {
  readonly systemPrompt: string | undefined
  readonly messages: ReadonlyArray<ClaudeConversationMessage>
} {
  const systemPrompt = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n")
  const conversationMessages = messages
    .filter(isClaudeConversationMessage)
    .map((message) => ({ role: message.role, content: message.content }))

  return {
    systemPrompt: systemPrompt.length > 0 ? systemPrompt : undefined,
    messages: conversationMessages.length > 0 ? conversationMessages : [{ role: "user", content: "" }]
  }
}

function isClaudeConversationMessage(message: AiMessage): message is AiMessage & { readonly role: ClaudeMessageRole } {
  return message.role === "user" || message.role === "assistant"
}

function usageFromClaudeResponse(response: ClaudeMessageResponse): AiUsage | undefined {
  const usage = response.usage
  if (!usage) {
    return undefined
  }

  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadInputTokens: usage.cache_read_input_tokens,
    cacheCreationInputTokens: usage.cache_creation_input_tokens
  }
}

function extractClaudeText(response: ClaudeMessageResponse): string {
  return response.content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text ?? "")
    .join("\n")
}

function createDefaultClaudeClient(apiKey: string): ClaudeClientLike {
  const client = new Anthropic({ apiKey })

  return {
    messages: {
      create: async (request): Promise<ClaudeMessageResponse> =>
        client.messages.create({
          ...request,
          messages: [...request.messages] as MessageParam[]
        }) as Promise<ClaudeMessageResponse>
    }
  }
}
