import { describe, expect, it } from "vitest"

import { ProjectFieldError, ProjectVersionError, assertSupportedProjectVersion, storyboardProjectVersion } from "@storyboard/story-model"
import { createDefaultProjectJson, parseProjectJson, serializeProjectJson } from "@storyboard/story-engine"

describe("project format version", () => {
  it("writes and opens a 2.0.0 work", () => {
    const project = createDefaultProjectJson({ name: "MagicBoy" })

    expect(project.version).toBe("2.0.0")
    expect(storyboardProjectVersion).toBe("2.0.0")
    expect(parseProjectJson(serializeProjectJson(project)).name).toBe("MagicBoy")
  })

  it("refuses a 0.15 work and says so", () => {
    const legacy = JSON.stringify({ ...createDefaultProjectJson({ name: "옛 작품" }), version: "1.0.0" })

    expect(() => parseProjectJson(legacy)).toThrow(ProjectVersionError)
    expect(() => parseProjectJson(legacy)).toThrow(/0\.15 형식/)
  })

  it("refuses a version it does not know", () => {
    try {
      assertSupportedProjectVersion({ version: "3.0.0" })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectVersionError)
      expect((error as ProjectVersionError).code).toBe("unknown-version")
    }
    expect(() => assertSupportedProjectVersion({})).toThrow(ProjectVersionError)
  })

  it("refuses the project fields 0.16 moved out of project.json, naming where they live", () => {
    const project = createDefaultProjectJson({ name: "줄기" })
    const withThreads = JSON.stringify({ ...project, setting: { tags: [], prohibitions: [], styleConstraints: [], qualityCriteria: [], threads: { ep1: { title: "1화" } } } })
    const withPrefixDigits = JSON.stringify({ ...project, editor: { scenePrefixDigits: 2 } })

    expect(() => parseProjectJson(withThreads)).toThrow(ProjectFieldError)
    expect(() => parseProjectJson(withThreads)).toThrow(/structure\.yaml/)
    expect(() => parseProjectJson(withPrefixDigits)).toThrow(/세 자리/)
  })

  it("never writes the threads the in-memory setting carries", () => {
    const project = createDefaultProjectJson({ name: "줄기" })
    const written = serializeProjectJson({
      ...project,
      setting: { tags: [], prohibitions: [], styleConstraints: [], qualityCriteria: [], threads: { ep1: { title: "1화" } } }
    })

    expect(written).not.toContain("threads")
  })
})
