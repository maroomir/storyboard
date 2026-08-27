import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  canonicalizeSceneCardText,
  parseScene,
  parseSceneFileName,
  parseSceneStem,
  resolveSceneOrder,
  serializeSceneCard,
  SceneParseError
} from '@storyboard/story-format';
const scenesFixtureDirectory = fileURLToPath(new URL("../../../../../../packages/story-format/test/fixtures/scenes/", import.meta.url))

describe("scene file codec", () => {
  it("parses a scene card into frontmatter view and prompt body", () => {
    const scene = parseScene(readFixtureScene("01-prologue.card"), "01-prologue.card")

    expect(scene).toMatchObject({
      stem: "01-prologue",
      order: 1,
      orderText: "01",
      slug: "prologue",
      card: {
        type: "scene",
        id: "01-prologue",
        summary: "샘플 캐릭터가 샘플 배경 안에서 첫 장면을 시작한다."
      },
      frontmatter: {
        title: "프롤로그",
        characters: ["sample"],
        location: "sample",
        mood: "시작"
      },
      body: "샘플 캐릭터가 샘플 배경 안에서 첫 장면을 시작한다.\n"
    })
  })

  it("parses a numeric targetWordCount", () => {
    const scene = parseScene(
      "type: scene\nid: 01-scene\ntitle: 장면\ntargetWordCount: 5000\nsummary: 본문\n",
      "01-scene.card"
    )

    expect(scene.frontmatter.targetWordCount).toBe(5000)
  })

  it("rejects a non-integer targetWordCount", () => {
    const rawScene = "type: scene\nid: 01-scene\ntitle: 장면\ntargetWordCount: many\nsummary: 본문\n"

    expect(() => parseScene(rawScene, "01-scene.card")).toThrow(SceneParseError)

    try {
      parseScene(rawScene, "01-scene.card")
    } catch (error) {
      expect((error as SceneParseError).code).toBe("invalid-scene-card-schema")
    }
  })

  it("renders structured seed fields as labeled prompt blocks", () => {
    const scene = parseScene(
      [
        "type: scene",
        "id: 03-turn",
        "title: 전환",
        "targetWordCount: 3000",
        "purpose: 목적 문장",
        "conflict: 갈등 문장",
        "foreshadowing:",
        "  - 복선 하나",
        "summary: 자유 메모",
        ""
      ].join("\n"),
      "03-turn.card"
    )

    expect(scene.body).toBe(
      "[목적]\n목적 문장\n\n[갈등]\n갈등 문장\n\n[회수할 복선]\n- 복선 하나\n\n[목표 분량]\n약 3,000자\n\n자유 메모\n"
    )
  })

  it("keeps a summary-only card round-trippable", () => {
    const rawScene = readFixtureScene("02-no-frontmatter.card")
    const scene = parseScene(rawScene, "02-no-frontmatter.card")

    expect(scene.frontmatter).toEqual({})
    expect(scene.body).toBe(`${scene.card.summary}\n`)
    expect(canonicalizeSceneCardText(rawScene)).toEqual({ text: rawScene, changed: false })
  })

  it("serializes scene cards canonically", () => {
    const serialized = serializeSceneCard({
      type: "scene",
      id: "01-prologue",
      summary: "본문",
      title: "프롤로그"
    })

    expect(serialized).toBe("type: scene\nid: 01-prologue\ntitle: 프롤로그\nsummary: 본문\n")
  })

  it("rejects a card whose type is not scene", () => {
    expect(() => parseScene("type: character\nid: sample\nname: 샘플\n", "01-scene.card")).toThrow(
      SceneParseError
    )
  })

  it("rejects invalid scene file names", () => {
    expect(() => parseScene("본문", "prologue.card")).toThrow(SceneParseError)

    try {
      parseScene("본문", "prologue.card")
    } catch (error) {
      expect(error).toBeInstanceOf(SceneParseError)
      expect((error as SceneParseError).code).toBe("invalid-scene-file-name")
    }
  })

  it("parses scene file names and stems consistently", () => {
    expect(parseSceneFileName("12-chapter-10.card")).toEqual({
      stem: "12-chapter-10",
      order: 12,
      orderText: "12",
      slug: "chapter-10"
    })
    expect(parseSceneStem("12-chapter-10")).toEqual({
      stem: "12-chapter-10",
      order: 12,
      orderText: "12",
      slug: "chapter-10"
    })
  })
})

describe("resolveSceneOrder", () => {
  it("returns a positive integer order unchanged", () => {
    expect(resolveSceneOrder(4)).toBe(4)
  })

  it("rejects non-positive or non-integer numbers", () => {
    expect(resolveSceneOrder(0)).toBeUndefined()
    expect(resolveSceneOrder(-4)).toBeUndefined()
    expect(resolveSceneOrder(4.5)).toBeUndefined()
  })

  it("parses a numeric string into its order", () => {
    expect(resolveSceneOrder("4")).toBe(4)
  })

  it("parses an NN-slug scene stem into its order", () => {
    expect(resolveSceneOrder("04-the-fall")).toBe(4)
  })

  it("returns undefined for unparseable references", () => {
    expect(resolveSceneOrder("banana")).toBeUndefined()
    expect(resolveSceneOrder("")).toBeUndefined()
  })
})

function readFixtureScene(fixtureName: string): string {
  return readFileSync(join(scenesFixtureDirectory, fixtureName), "utf8")
}

describe("scene card endState and povCharacter", () => {
  const cardText = [
    "type: scene",
    "id: 07-auction",
    "povCharacter: 한이준",
    "endState: 발키리 일행이 경매홀에 들어서는 순간까지",
    "purpose: 기록 조각의 단서를 손에 넣는다",
    "summary: 이준과 채린이 경매장에 들어선다.",
    ""
  ].join("\n")

  it("parses both fields and exposes povCharacter on the frontmatter view", () => {
    const scene = parseScene(cardText, "07-auction.card")

    expect(scene.card.endState).toBe("발키리 일행이 경매홀에 들어서는 순간까지")
    expect(scene.card.povCharacter).toBe("한이준")
    expect(scene.frontmatter.povCharacter).toBe("한이준")
  })

  it("renders the end state as a prompt block that forbids overrunning it", () => {
    const scene = parseScene(cardText, "07-auction.card")

    expect(scene.body).toContain("[이 장면의 종료 지점]")
    expect(scene.body).toContain("발키리 일행이 경매홀에 들어서는 순간까지")
    expect(scene.body).toContain("다음 장면의 몫이므로 쓰지 마라")
  })

  it("round-trips both fields through serialization", () => {
    const scene = parseScene(cardText, "07-auction.card")
    const reparsed = parseScene(serializeSceneCard(scene.card), "07-auction.card")

    expect(reparsed.card.endState).toBe(scene.card.endState)
    expect(reparsed.card.povCharacter).toBe(scene.card.povCharacter)
  })

  it("omits the end state block when the field is absent", () => {
    const scene = parseScene("type: scene\nid: 01-a\nsummary: 본문\n", "01-a.card")

    expect(scene.body).not.toContain("[이 장면의 종료 지점]")
    expect(scene.frontmatter.povCharacter).toBeUndefined()
  })
})
