import { describe, expect, it } from "vitest"

import {
  StructureParseError,
  listThreadScenes,
  parseStoryStructure,
  serializeStoryStructure,
} from "@storyboard/story-model"

const arrival = "9d41b2c3-4d5e-4f6a-8b7c-1d2e3f4a5b6c"
const rooftop = "c2e8a1b4-9d7c-4e3f-a2b1-0c9d8e7f6a5b"
const letter = "4e5f6a7b-8c9d-4e0f-9a1b-2c3d4e5f6a7b"
const eliaFirst = "e1f0a2b3-c4d5-4e6f-8a7b-9c0d1e2f3a4b"

const structureText = `threads:
  - id: main
    title: 본편
  - id: jun
    title: 준의 이야기
scenes:
  - scene: ${arrival}
    thread: main
    narrator: ${eliaFirst}
  - scene: ${rooftop}
    thread: main
    storyTime: 2
  - scene: ${letter}
    thread: jun
`

describe("structure file", () => {
  it("reads the threads and the one scene order of the whole work and writes the same bytes back", () => {
    const structure = parseStoryStructure(structureText, "structure.yaml")

    expect(structure.threads.map((thread) => thread.id)).toEqual(["main", "jun"])
    expect(listThreadScenes(structure, "main").map((entry) => entry.scene)).toEqual([arrival, rooftop])
    expect(serializeStoryStructure(structure)).toBe(structureText)
  })

  it("keeps a frame thread's wraps", () => {
    const text = `threads:\n  - id: frame\n    title: 외화\n    wraps:\n      - inner\n  - id: inner\n    title: 내화\nscenes: []\n`

    expect(serializeStoryStructure(parseStoryStructure(text, "structure.yaml"))).toBe(text)
  })

  it("names the file and the problem when the structure does not hold together", () => {
    const cases = [
      `threads: []\nscenes: []\n`,
      `threads:\n  - { id: main, title: 본편 }\nscenes:\n  - { scene: ${arrival}, thread: side }\n`,
      `threads:\n  - { id: main, title: 본편 }\nscenes:\n  - { scene: ${arrival}, thread: main }\n  - { scene: ${arrival}, thread: main }\n`,
      `threads:\n  - { id: main, title: 본편 }\nscenes:\n  - { scene: arrival, thread: main }\n`,
      `threads:\n  - { id: main, title: 본편 }\nscenes:\n  - { scene: ${arrival}, thread: main, storyTime: 다음 날 }\n`,
    ]

    for (const text of cases) {
      expect(() => parseStoryStructure(text, "structure.yaml"), text).toThrow(StructureParseError)
    }
    expect(() => parseStoryStructure("threads: [", "structure.yaml")).toThrow(/structure\.yaml/)
  })
})
