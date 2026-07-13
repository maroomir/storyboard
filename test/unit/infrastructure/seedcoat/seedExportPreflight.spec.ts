import { describe, expect, it } from "vitest"

import { listSeedExportPreflightIssues } from "@/infrastructure/seedcoat/seedExportPreflight"
import type { WorkspaceContent } from "@/services/seedcoat/projectAdapter"

function minimalWorkspace(overrides?: Partial<WorkspaceContent>): WorkspaceContent {
  return {
    project: {
      version: "1.0.0",
      id: "00000000-0000-4000-8000-000000000001",
      name: "Test",
      format: "novel",
      language: "ko",
      createdAt: "2026-05-13T08:00:00.000Z",
      editor: { scenePrefixDigits: 2 }
    },
    characters: [],
    backgrounds: [],
    scenes: [{ stem: "01-opening", content: "body\n" }],
    ...overrides
  }
}

describe("seedExportPreflight", () => {
  it("returns no issues when stems and prefix digits match seedcoat", () => {
    expect(listSeedExportPreflightIssues(minimalWorkspace())).toEqual([])
  })

  it("flags non-two-digit scene prefix digits", () => {
    const issues = listSeedExportPreflightIssues(
      minimalWorkspace({
        project: {
          version: "1.0.0",
          id: "00000000-0000-4000-8000-000000000001",
          name: "Test",
          format: "novel",
          language: "ko",
          createdAt: "2026-05-13T08:00:00.000Z",
          editor: { scenePrefixDigits: 3 }
        }
      })
    )

    expect(issues.some((issue) => issue.includes("scenePrefixDigits"))).toBe(true)
  })

  it("flags scene stems that do not match two-digit prefix pattern", () => {
    const issues = listSeedExportPreflightIssues(
      minimalWorkspace({
        scenes: [{ stem: "1-opening", content: "body\n" }]
      })
    )

    expect(issues.some((issue) => issue.includes("1-opening"))).toBe(true)
  })
})
