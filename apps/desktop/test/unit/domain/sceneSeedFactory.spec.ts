import { describe, expect, it } from "vitest"

import { buildSceneSeeds } from "@/domain/sceneSeedFactory"
import { parseScene } from '@seedkernel/wasm';
import type { ChapterPlan } from '@seedkernel/wasm';
const plan: ChapterPlan = {
  version: "1.0.0",
  acts: [
    {
      id: "act-1",
      title: "발단",
      chapters: [
        {
          id: "chapter-1-1",
          title: "1장",
          scenes: [
            {
              id: "arrival",
              title: "도착",
              purpose: "주인공 소개",
              characters: ["elia", "jihoon"],
              location: "school",
              emotionalShift: "불안 → 설렘",
              foreshadowing: ["전학 이유"]
            },
            {
              id: "first-class",
              title: "첫 수업",
              purpose: "관계의 시작",
              characters: ["elia"],
              foreshadowing: []
            }
          ]
        }
      ]
    },
    {
      id: "act-2",
      title: "전개",
      chapters: [
        {
          id: "chapter-2-1",
          title: "2장",
          scenes: [
            { id: "rumor", title: "소문", purpose: "갈등 점화", characters: [], foreshadowing: [] }
          ]
        }
      ]
    }
  ]
}

describe("buildSceneSeeds", () => {
  it("flattens scenes in act/chapter/scene order with sequential prefixes", () => {
    const seeds = buildSceneSeeds(plan, 2)

    expect(seeds.map((seed) => seed.fileName)).toEqual([
      "01-arrival.txt",
      "02-first-class.txt",
      "03-rumor.txt"
    ])
  })

  it("respects the configured prefix digit count", () => {
    const seeds = buildSceneSeeds(plan, 3)
    expect(seeds[0]?.fileName).toBe("001-arrival.txt")
  })

  it("produces valid scene files with frontmatter and seed body", () => {
    const [first] = buildSceneSeeds(plan, 2)
    const scene = parseScene(first.content, first.fileName)

    expect(scene.frontmatter.title).toBe("도착")
    expect(scene.frontmatter.characters).toEqual(["elia", "jihoon"])
    expect(scene.frontmatter.location).toBe("school")
    expect(scene.body).toContain("[목적]")
    expect(scene.body).toContain("주인공 소개")
    expect(scene.body).toContain("[감정 변화]")
    expect(scene.body).toContain("[회수할 복선]")
    expect(scene.body).toContain("- 전학 이유")
  })

  it("renders conflict, twist, and needed-canon sections when present", () => {
    const richPlan: ChapterPlan = {
      version: "1.0.0",
      acts: [
        {
          id: "act-1",
          title: "발단",
          chapters: [
            {
              id: "chapter-1-1",
              title: "1장",
              scenes: [
                {
                  id: "duel",
                  title: "결투",
                  purpose: "대립 점화",
                  characters: ["elia"],
                  conflict: "엘리아 대 지훈",
                  twist: "지훈이 형이었다",
                  foreshadowing: [],
                  neededCanon: ["엘리아의 검술 실력"],
                  targetWordCount: 3000
                }
              ]
            }
          ]
        }
      ]
    }

    const [seed] = buildSceneSeeds(richPlan, 2)
    const scene = parseScene(seed.content, seed.fileName)

    expect(scene.body).toContain("[갈등]\n엘리아 대 지훈")
    expect(scene.body).toContain("[반전]\n지훈이 형이었다")
    expect(scene.body).toContain("[필요 설정]")
    expect(scene.body).toContain("- 엘리아의 검술 실력")
    expect(scene.body).toContain("[목표 분량]")
    expect(scene.body).toContain("약 3,000자")
  })

  it("omits optional frontmatter and sections when the plan lacks them", () => {
    const seeds = buildSceneSeeds(plan, 2)
    const rumor = parseScene(seeds[2].content, seeds[2].fileName)

    expect(rumor.frontmatter.characters).toBeUndefined()
    expect(rumor.frontmatter.location).toBeUndefined()
    expect(rumor.body).not.toContain("[감정 변화]")
    expect(rumor.body).not.toContain("[회수할 복선]")
  })

  it("derives fallback slugs and keeps them unique", () => {
    const koreanPlan: ChapterPlan = {
      version: "1.0.0",
      acts: [
        {
          id: "막",
          title: "막",
          chapters: [
            {
              id: "장",
              title: "장",
              scenes: [
                { id: "한글", title: "한글", purpose: "", characters: [], foreshadowing: [] },
                { id: "한글", title: "한글", purpose: "", characters: [], foreshadowing: [] }
              ]
            }
          ]
        }
      ]
    }

    const seeds = buildSceneSeeds(koreanPlan, 2)
    expect(seeds.map((seed) => seed.fileName)).toEqual(["01-scene-1.txt", "02-scene-2.txt"])
  })
})
