import {
  type AiGenerateRequest,
  type AiGenerateResponse,
  type AiProvider,
  type AiProviderId
} from "../types"

export class MockAiProvider implements AiProvider {
  public readonly id: AiProviderId = "mock"
  public readonly displayName = "Mock AI"

  public async checkConnection(): Promise<boolean> {
    return true
  }

  public async generate(request: AiGenerateRequest): Promise<AiGenerateResponse> {
    const userPrompt = request.messages
      .filter((message) => message.role === "user")
      .map((message) => message.content.trim())
      .filter((content) => content.length > 0)
      .join("\n\n")

    return {
      providerId: this.id,
      model: "mock-model",
      text: createMockResponse(request.taskName, userPrompt)
    }
  }
}

function createMockResponse(taskName: string, userPrompt: string): string {
  const promptSummary = userPrompt.length > 0 ? userPrompt : "입력된 프롬프트가 없습니다."

  return [`[Mock AI: ${taskName}]`, promptSummary, "", "이 응답은 PR-3b 연결 검증용 모의 AI 출력입니다."].join("\n")
}
