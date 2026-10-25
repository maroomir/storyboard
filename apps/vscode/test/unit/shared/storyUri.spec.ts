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
