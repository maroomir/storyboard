import { GoogleGenerativeAI } from "@google/generative-ai"

import { AiProviderError } from "../AiProviderError"
import {
  type AiGenerateRequest,
  type AiGenerateResponse,
  type AiProvider,
  type AiProviderId
} from "../types"

interface GoogleGenerativeModelLike {
  readonly generateContent: (prompt: string) => Promise<GoogleGenerateContentResultLike>
}

interface GoogleGenerateContentResultLike {
  readonly response: {
    readonly text: () => string
  }
}

export interface GoogleClientLike {
  readonly getGenerativeModel: (options: GoogleModelOptions) => GoogleGenerativeModelLike
}

export interface GoogleProviderOptions {
  readonly apiKey: string | undefined
  readonly model: string | undefined
  readonly createClient?: (apiKey: string) => GoogleClientLike
}

interface GoogleModelOptions {
  readonly model: string
  readonly generationConfig?: {
    readonly temperature?: number
    readonly maxOutputTokens?: number
  }
}

export class GoogleProvider implements AiProvider {
  public readonly id: AiProviderId = "google"
  public readonly displayName = "Google Gemini"
  private readonly client: GoogleClientLike
  private readonly model: string

  public constructor(options: GoogleProviderOptions) {
    const apiKey = options.apiKey?.trim()
    const model = options.model?.trim()

    if (!apiKey) {
      throw new AiProviderError("missing-api-key", this.id, "Google API 키가 설정되어 있지 않습니다.")
    }

    if (!model) {
      throw new AiProviderError("missing-model", this.id, "Google 모델이 설정되어 있지 않습니다.")
    }

    this.model = model
    this.client = options.createClient?.(apiKey) ?? createDefaultGoogleClient(apiKey)
  }

  public async checkConnection(): Promise<boolean> {
    try {
      const model = this.client.getGenerativeModel({ model: this.model })
      const result = await model.generateContent("test")
      return result.response.text().length > 0
    } catch (error) {
      throw new AiProviderError("connection-failed", this.id, "Google Gemini 연결 확인에 실패했습니다.", error)
    }
  }

  public async generate(request: AiGenerateRequest): Promise<AiGenerateResponse> {
    try {
      const model = this.client.getGenerativeModel({
        model: this.model,
        generationConfig: {
          temperature: request.temperature,
          maxOutputTokens: request.maxTokens
        }
      })
      const result = await model.generateContent(createGooglePrompt(request))

      return {
        providerId: this.id,
        model: this.model,
        text: result.response.text()
      }
    } catch (error) {
      throw new AiProviderError("generation-failed", this.id, "Google Gemini 텍스트 생성에 실패했습니다.", error)
    }
  }
}

function createGooglePrompt(request: AiGenerateRequest): string {
  return request.messages.map((message) => `${message.role.toUpperCase()}:\n${message.content}`).join("\n\n")
}

function createDefaultGoogleClient(apiKey: string): GoogleClientLike {
  const client = new GoogleGenerativeAI(apiKey)

  return {
    getGenerativeModel: (options): GoogleGenerativeModelLike => client.getGenerativeModel(options)
  }
}
