import { posix } from "node:path"

import { describe, expect, it } from "vitest"

import { joinStoryPath, type StoryUri } from "@storyboard/story-model"

function uriWithPath(value: string): StoryUri {
  return {
    scheme: "file",
    authority: "",
    path: value,
    query: "",
    fragment: "",
    fsPath: value,
    with: (change) => uriWithPath(change.path ?? value),
    toString: () => value,
    toJSON: () => value
  }
}

// story-model 은 브라우저 번들에도 실리므로 node:path 를 쓸 수 없다. 손으로 구현한 join 이
// 표준 라이브러리와 갈라지면 워크스페이스 파일이 엉뚱한 자리에 쓰이므로 여기서 대조한다.
const cases: readonly (readonly string[])[] = [
  ["/work", "scene", "01-start.card"],
  ["/work/", "/scene/", "01.card"],
  ["/work", "draft/01.md"],
  ["/work", ".."],
  ["/work/a/b", "../..", "c"],
  ["/work", ".", "scene"],
  ["/", "scene"],
  ["/work", ""],
  ["/work", "a//b"],
  ["relative", "scene", "01.card"],
  ["relative", "..", "..", "x"],
  ["/work", "scene/"]
]

describe("joinStoryPath", () => {
  it("agrees with posix.join on every shape the workspace produces", () => {
    for (const [base, ...segments] of cases) {
      const expected = posix.join(base as string, ...segments)

      expect(joinStoryPath(uriWithPath(base as string), ...segments).path, cases.toString()).toBe(
        expected
      )
    }
  })
})
