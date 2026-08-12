import { describe, expect, it } from "vitest"

import { detectCharactersInText } from '@seedkernel/wasm';

describe("characterDetector", () => {
  it("detects characters using simple substring matching", () => {
    const text = "엘리아가 정문에 서서 지훈을 기다린다. 마루는 아직 오지 않았다."
    const names = ["엘리아", "지훈", "마루", "없는사람"]

    const detected = detectCharactersInText(text, names)

    expect(detected).toHaveLength(3)
    expect(detected).toContain("엘리아")
    expect(detected).toContain("지훈")
    expect(detected).toContain("마루")
    expect(detected).not.toContain("없는사람")
  })

  it("returns empty array if no names provided", () => {
    expect(detectCharactersInText("본문", [])).toEqual([])
  })
})
