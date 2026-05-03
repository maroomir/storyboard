import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { parseScene, SceneParseError } from "../../../src/files/scene"
import { parseSceneFileName, parseSceneStem } from "../../../src/shared/scene"

const scenesFixtureDirectory = join(process.cwd(), "test", "fixtures", "scenes")

describe("scene file codec", () => {
  it("parses frontmatter and body from a scene seed", () => {
    const scene = parseScene(readFixtureScene("01-prologue.txt"), "01-prologue.txt")

    expect(scene).toMatchObject({
      stem: "01-prologue",
      order: 1,
      orderText: "01",
      slug: "prologue",
      frontmatter: {
        title: "프롤로그",
        characters: ["sample"],
        location: "sample",
        mood: "시작"
      },
      body: "샘플 캐릭터가 샘플 배경 안에서 첫 장면을 시작한다."
    })
  })

  it("keeps the full body when frontmatter is omitted", () => {
    const rawScene = readFixtureScene("02-no-frontmatter.txt")
    const scene = parseScene(rawScene, "02-no-frontmatter.txt")

    expect(scene.frontmatter).toEqual({})
    expect(scene.body).toBe(rawScene)
  })

  it("rejects invalid scene file names", () => {
    expect(() => parseScene("본문", "prologue.txt")).toThrow(SceneParseError)

    try {
      parseScene("본문", "prologue.txt")
    } catch (error) {
      expect(error).toBeInstanceOf(SceneParseError)
      expect((error as SceneParseError).code).toBe("invalid-scene-file-name")
    }
  })

  it("parses scene file names and stems consistently", () => {
    expect(parseSceneFileName("12-chapter-10.txt")).toEqual({
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

function readFixtureScene(fixtureName: string): string {
  return readFileSync(join(scenesFixtureDirectory, fixtureName), "utf8")
}