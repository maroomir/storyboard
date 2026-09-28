import { describe, expect, it } from "vitest"

import { GrammarCheckPrompt } from "@storyboard/story-ai"

// 프롬프트 문구를 리소스 파일로 옮겨도 렌더 결과가 바이트 단위로 같아야 한다. 스냅샷이 그 증거다.
describe("GrammarCheckPrompt golden", () => {
  const body = "그는 학교에 갔다 . 그리고나서 밥을 먹었다"

  it.each(["generic", "xs", "rich"] as const)("renders the %s variant", (variant) => {
    expect(GrammarCheckPrompt.build(body, variant)).toMatchSnapshot()
  })
})
