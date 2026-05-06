export interface GrammarCheckIssuePayload {
  readonly start: number
  readonly end: number
  readonly original: string
  readonly suggestion: string
  readonly reason: string
}

export const GrammarCheckPrompt = {
  config: {
    temperature: 0.1,
    maxTokens: 2000
  },
  build(body: string): string {
    return [
      "당신은 한국어 문장 교정 도우미입니다.",
      "입력 본문을 검사해 문법/맞춤법/띄어쓰기 문제만 찾아주세요.",
      "아래 JSON 배열만 출력하세요. 설명 문장은 금지입니다.",
      '[{"start":0,"end":0,"original":"","suggestion":"","reason":""}]',
      "start/end는 UTF-16 기준 0-based offset이며, end는 exclusive입니다.",
      "",
      "[본문]",
      body
    ].join("\n")
  }
} as const
