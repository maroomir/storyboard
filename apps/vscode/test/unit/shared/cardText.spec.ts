import { describe, expect, it } from "vitest"

import { joinCardText, splitCardTextToList } from '@storyboard/story-model';

describe("joinCardText", () => {
  it("returns an empty string for undefined or empty input", () => {
    expect(joinCardText(undefined)).toBe("")
    expect(joinCardText([])).toBe("")
  })

  it("joins list items with newlines", () => {
    expect(joinCardText(["느린 말투로 말한다", "어조에 농담을 섞는다"])).toBe(
      "느린 말투로 말한다\n어조에 농담을 섞는다"
    )
  })
})

describe("splitCardTextToList", () => {
  it("splits multi-line prose into trimmed items", () => {
    expect(splitCardTextToList("주인공.\n17세 여학생.")).toEqual(["주인공.", "17세 여학생."])
  })

  it("keeps single-line prose as one item", () => {
    expect(splitCardTextToList("느린 말투로 말한다")).toEqual(["느린 말투로 말한다"])
  })

  it("strips leading bullet markers and drops empty lines", () => {
    expect(splitCardTextToList("- 느린 말투\n* 농담\n\n• 놀리기")).toEqual(["느린 말투", "농담", "놀리기"])
  })
})
