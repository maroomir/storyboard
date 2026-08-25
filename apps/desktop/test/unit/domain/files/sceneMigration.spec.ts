import { describe, expect, it } from "vitest"

import {
  canonicalizeSceneCardText,
  convertLegacySceneText,
  isLegacySceneFileName,
  SceneParseError
} from '@storyboard/story-format';

describe("legacy scene conversion", () => {
  it("recognizes legacy scene file names", () => {
    expect(isLegacySceneFileName("01-prologue.txt")).toBe(true)
    expect(isLegacySceneFileName("01-prologue.card")).toBe(false)
    expect(isLegacySceneFileName(".sample.txt")).toBe(false)
    expect(isLegacySceneFileName("readme.txt")).toBe(false)
  })

  it("maps seed-dialect labeled sections onto structured fields", () => {
    const legacy = [
      "---",
      "title: 돌아온 배",
      "characters:",
      "  - seoyeon",
      "location: 해솔포",
      "grounding:",
      "  incident: 폐항 예정일을 확인했다.",
      "---",
      "[목적]",
      "귀향 이유를 제시한다.",
      "",
      "[갈등]",
      "복순은 떠나라고 한다.",
      "",
      "[반전]",
      "날짜가 일치한다.",
      "",
      "[감정 변화]",
      "발걸음을 멈췄다.",
      "",
      "[회수할 복선]",
      "- 폐항 예정일",
      "- 방파제 사진",
      "",
      "[필요 설정]",
      "- 해솔포는 가상의 어촌이다.",
      "",
      "[목표 분량]",
      "약 3,000자",
      "",
      "> 1막 · 빈 항구 — 자동 생성된 씬 시드입니다.",
      ""
    ].join("\n")

    const conversion = convertLegacySceneText(legacy, "01-return.txt")

    expect(conversion.fileName).toBe("01-return.card")
    expect(conversion.card).toEqual({
      type: "scene",
      id: "01-return",
      title: "돌아온 배",
      characters: ["seoyeon"],
      location: "해솔포",
      targetWordCount: 3000,
      grounding: { incident: "폐항 예정일을 확인했다." },
      purpose: "귀향 이유를 제시한다.",
      conflict: "복순은 떠나라고 한다.",
      twist: "날짜가 일치한다.",
      emotionalShift: "발걸음을 멈췄다.",
      foreshadowing: ["폐항 예정일", "방파제 사진"],
      neededCanon: ["해솔포는 가상의 어촌이다."],
      summary: "> 1막 · 빈 항구 — 자동 생성된 씬 시드입니다."
    })
    expect(canonicalizeSceneCardText(conversion.text)).toEqual({
      text: conversion.text,
      changed: false
    })
  })

  it("moves free prose into summary without interpretation", () => {
    const legacy = [
      "---",
      "title: 첫 기억을 팔러 온 남자",
      "characters: [seoha, juno]",
      "mood: 낯선 긴장",
      "---",
      "장마가 이어지는 밤, 준오가 수길당의 문을 연다.",
      "",
      "서하는 경고를 세 번 반복한다.",
      ""
    ].join("\n")

    const conversion = convertLegacySceneText(legacy, "01-selling.txt")

    expect(conversion.card).toEqual({
      type: "scene",
      id: "01-selling",
      title: "첫 기억을 팔러 온 남자",
      characters: ["seoha", "juno"],
      mood: "낯선 긴장",
      summary: "장마가 이어지는 밤, 준오가 수길당의 문을 연다.\n\n서하는 경고를 세 번 반복한다."
    })
  })

  it("converts a frontmatter-less scene into a summary-only card", () => {
    const conversion = convertLegacySceneText("본문만 있는 씬.\n", "02-plain.txt")

    expect(conversion.card).toEqual({
      type: "scene",
      id: "02-plain",
      summary: "본문만 있는 씬."
    })
  })

  it("drops the unwritten-purpose placeholder", () => {
    const conversion = convertLegacySceneText("[목적]\n_미작성_\n", "03-empty.txt")

    expect(conversion.card).toEqual({ type: "scene", id: "03-empty" })
  })

  it("prefers the frontmatter targetWordCount over the body marker", () => {
    const legacy = "---\ntargetWordCount: 5000\n---\n[목표 분량]\n약 3,000자\n"
    const conversion = convertLegacySceneText(legacy, "04-length.txt")

    expect(conversion.card.targetWordCount).toBe(5000)
  })

  it("rejects a non-legacy file name", () => {
    expect(() => convertLegacySceneText("본문", "01-scene.card")).toThrow(SceneParseError)
  })
})
