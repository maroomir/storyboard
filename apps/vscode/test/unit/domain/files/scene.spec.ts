import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  canonicalizeSceneCardText,
  extractInlineSceneSummary,
  extractSceneNarrativeSource,
  splitSceneNarrativeSource,
  isInlineSceneSummary,
  NodeUri,
  parseScene,
  parseSceneFileName,
  parseSceneStem,
  renderSceneCardBody,
  readSceneFile,
  resolveSceneOrder,
  sceneSummaryReference,
  serializeSceneCard,
  SceneParseError
} from '@storyboard/story-model';
const scenesFixtureDirectory = fileURLToPath(new URL("../../../../../../packages/story-model/test/fixtures/scenes/", import.meta.url))

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

describe("scene card twist directive", () => {
  const cardText = [
    "type: scene",
    "id: 01-square",
    "twist: 공지가 뜬 순간 광장의 모든 NPC가 반 박자 멈췄고, 그걸 본 사람은 이준뿐이다",
    "summary: 광장에 공지가 뜬다.",
    ""
  ].join("\n")

  it("asks for the anomaly to be legible and its witness unique", () => {
    const scene = parseScene(cardText, "01-square.card")

    expect(scene.body).toContain("[반전]")
    expect(scene.body).toContain("그걸 본 사람은 이준뿐이다")
    expect(scene.body).toContain("독자가 이상을 분명히 알아볼 수 있게")
    expect(scene.body).toContain("평소에는 어땠는지를 먼저 보이고")
    expect(scene.body).toContain("다른 사람들은 알아채지 못한다는 것까지")
  })

  it("omits the directive when the card has no twist", () => {
    const scene = parseScene("type: scene\nid: 01-a\nsummary: 본문\n", "01-a.card")

    expect(scene.body).not.toContain("독자가 이상을 분명히 알아볼 수 있게")
  })
})

describe("extractSceneNarrativeSource", () => {
  it("drops craft blocks so only the event summary reaches situation extraction", () => {
    const cardText = [
      "type: scene",
      "id: 01-square",
      "conflict: 발키리가 레벨 0을 조롱하며 시비를 건다",
      "endState: 광장을 벗어나는 데까지 쓰고 브로크와의 대면은 다음 장면에 넘긴다",
      "summary: 이준이 좌판을 정리한다. 하늘에 공지가 뜬다.",
      ""
    ].join("\n")
    const scene = parseScene(cardText, "01-square.card")

    const narrative = extractSceneNarrativeSource(scene.body)

    expect(narrative).toBe("이준이 좌판을 정리한다. 하늘에 공지가 뜬다.")
    expect(narrative).not.toContain("[갈등]")
    expect(narrative).not.toContain("시비를 건다")
    expect(narrative).not.toContain("브로크와의 대면")
  })

  it("falls back to the whole body when it holds no plain narrative", () => {
    const scene = parseScene("type: scene\nid: 01-a\nconflict: 다툰다\n", "01-a.card")

    expect(extractSceneNarrativeSource(scene.body)).toContain("[갈등]")
  })
})

describe("splitSceneNarrativeSource", () => {
  // 비트·요약이 있으면 설계 블록이 통째로 버려져 뼈대가 목적·갈등·반전을 모르는 채 쓰였다.
  it("keeps the craft blocks as design instead of dropping them", () => {
    const cardText = [
      "type: scene",
      "id: 01-square",
      "purpose: 종료 공지로 세계의 시한을 박는다",
      "conflict: 발키리가 레벨 0을 조롱하며 시비를 건다",
      "summary: 이준이 좌판을 정리한다. 하늘에 공지가 뜬다.",
      ""
    ].join("\n")
    const scene = parseScene(cardText, "01-square.card")

    const parts = splitSceneNarrativeSource(scene.body)

    expect(parts.narrative).toBe("이준이 좌판을 정리한다. 하늘에 공지가 뜬다.")
    expect(parts.design).toContain("[목적]")
    expect(parts.design).toContain("[갈등]")
    // 재료와 설계는 섞이지 않는다 — 섞이면 카드 메타가 그대로 산문에 실린다.
    expect(parts.narrative).not.toContain("[갈등]")
  })

  it("leaves design empty when the whole body is already the material", () => {
    const scene = parseScene("type: scene\nid: 01-a\nconflict: 다툰다\n", "01-a.card")

    const parts = splitSceneNarrativeSource(scene.body)

    expect(parts.narrative).toContain("[갈등]")
    expect(parts.design).toBe("")
  })
})

describe("scene summary file and beats", () => {
  const fileSystem = {
    files: new Map<string, string>(),
    async readFile(uri: NodeUri): Promise<Uint8Array> {
      const content = this.files.get(uri.path)
      if (content === undefined) {
        throw new Error(`not found: ${uri.path}`)
      }
      return new TextEncoder().encode(content)
    }
  }

  it("keeps the summary reference and beats round-trippable in canonical order", () => {
    const rawScene = readFixtureScene("03-summary-file.card")
    const scene = parseScene(rawScene, "03-summary-file.card")

    expect(scene.card.summary).toBe("03-summary-file.summary.md")
    expect(scene.card.beats).toHaveLength(2)
    expect(canonicalizeSceneCardText(rawScene)).toEqual({ text: rawScene, changed: false })
  })

  it("renders beats as the narrative and keeps the summary prose as a design block", () => {
    const scene = parseScene(
      readFixtureScene("03-summary-file.card"),
      "03-summary-file.card",
      "요약 산문 첫 문단.\n\n둘째 문단에는 말버릇 메모가 있다."
    )

    expect(scene.summaryText).toBe("요약 산문 첫 문단.\n\n둘째 문단에는 말버릇 메모가 있다.")
    expect(scene.body).toBe(
      "[목표 분량]\n약 3,000자\n\n[창작자 요약]\n요약 산문 첫 문단.\n둘째 문단에는 말버릇 메모가 있다.\n\n샘플 캐릭터가 방송실 문을 연다.\n\n책상 위에 낯선 사연 엽서가 놓여 있다.\n"
    )
    // 파이프라인 뼈대 단계는 이 narrativeSource 만 사건 재료로 쓰므로 비트가 그대로 들어가야 하고,
    // 요약 메모는 설계 블록으로 따로 간다(#88-1: 비트가 있으면 메모가 통째로 버려졌다).
    expect(extractSceneNarrativeSource(scene.body)).toBe(
      "샘플 캐릭터가 방송실 문을 연다.\n\n책상 위에 낯선 사연 엽서가 놓여 있다."
    )
    expect(splitSceneNarrativeSource(scene.body).design).toContain("[창작자 요약]\n요약 산문 첫 문단.\n둘째 문단에는 말버릇 메모가 있다.")
  })

  it("round-trips beat coordinates and renders them under the beat", () => {
    const rawScene = readFixtureScene("04-beat-coordinates.card")
    const scene = parseScene(rawScene, "04-beat-coordinates.card")

    expect(canonicalizeSceneCardText(rawScene)).toEqual({ text: rawScene, changed: false })
    expect(scene.card.beats?.[0]).toEqual({ text: "엘리아가 정문 앞에서 숨을 고른다.", cast: ["elia"], place: "교문 앞", time: "등교 직전" })
    expect(scene.card.beats?.[1]).toBe("지훈이 먼저 이름을 부른다.")
    expect(extractSceneNarrativeSource(scene.body)).toBe(
      [
        "엘리아가 정문 앞에서 숨을 고른다.\n(출연: elia / 장소: 교문 앞 / 시각: 등교 직전)",
        "지훈이 먼저 이름을 부른다.",
        "둘은 나란히 교문을 지난다.\n(출연: elia, jihoon)",
      ].join("\n\n")
    )
    // 프롬프트에는 카드 id 대신 이름이 간다.
    expect(renderSceneCardBody(scene.card, undefined, (ref) => ({ elia: "엘리아", jihoon: "지훈" })[ref] ?? ref)).toContain(
      "(출연: 엘리아, 지훈)"
    )
  })

  it("renders the summary file text when the card has no beats", () => {
    const scene = parseScene("type: scene\nid: 04-a\nsummary: 04-a.summary.md\n", "04-a.card", "파일 산문\n")

    expect(scene.body).toBe("파일 산문\n")
  })

  it("does not treat a summary reference as narrative when no file text is supplied", () => {
    const scene = parseScene("type: scene\nid: 04-a\nsummary: 04-a.summary.md\n", "04-a.card")

    expect(scene.body).toBe("")
    expect(scene.summaryText).toBeUndefined()
  })

  it("reads the summary file next to the card", async () => {
    fileSystem.files.set("/ws/scene/03-summary-file.card", readFixtureScene("03-summary-file.card"))
    fileSystem.files.set("/ws/scene/03-summary-file.summary.md", readFixtureScene("03-summary-file.summary.md"))

    const scene = await readSceneFile(NodeUri.file("/ws/scene/03-summary-file.card"), fileSystem, "03-summary-file.card")

    expect(scene.summaryText).toBe("샘플 캐릭터가 방송실에 들어와 낯선 사연 엽서를 발견한다.\n")
  })

  it("fails loudly when the referenced summary file is missing", async () => {
    fileSystem.files.set("/ws/scene/05-lost.card", "type: scene\nid: 05-lost\nsummary: 05-lost.summary.md\n")

    await expect(readSceneFile(NodeUri.file("/ws/scene/05-lost.card"), fileSystem, "05-lost.card")).rejects.toMatchObject({
      code: "missing-scene-summary-file"
    })
  })

  it("distinguishes a file reference from inline prose", () => {
    expect(sceneSummaryReference(" 01-a.summary.md ")).toBe("01-a.summary.md")
    expect(sceneSummaryReference("01-a.summary.md 를 본다")).toBeUndefined()
    expect(isInlineSceneSummary("01-a.summary.md")).toBe(false)
    expect(isInlineSceneSummary("산문")).toBe(true)
    expect(isInlineSceneSummary("  ")).toBe(false)
    expect(isInlineSceneSummary(undefined)).toBe(false)
  })

  it("extracts inline prose into a summary file reference", () => {
    const extraction = extractInlineSceneSummary({ type: "scene", id: "01-a", summary: "산문 한 줄\n" })

    expect(extraction).toEqual({
      card: { type: "scene", id: "01-a", summary: "01-a.summary.md" },
      summaryFileName: "01-a.summary.md",
      summaryText: "산문 한 줄\n"
    })
    expect(extractInlineSceneSummary({ type: "scene", id: "01-a", summary: "01-a.summary.md" })).toBeUndefined()
    expect(extractInlineSceneSummary({ type: "scene", id: "01-a" })).toBeUndefined()
  })
})
