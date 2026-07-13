import { describe, expect, it, vi } from "vitest"

import {
  archiveExistingDraft,
  draftHistoryArchiveFileName,
  formatDraftHistoryTimestamp,
  nextDraftHistoryRevision,
  parseDraftHistoryRevision,
  type DraftHistoryFileSystem
} from "@/domain/files/draftHistory"

describe("draft history naming", () => {
  it("formats the timestamp as yyyy-mm-dd-hh-mm in local time", () => {
    const date = new Date(2026, 5, 7, 9, 3)
    expect(formatDraftHistoryTimestamp(date)).toBe("2026-06-07-09-03")
  })

  it("builds an archive file name with a zero-padded revision", () => {
    expect(draftHistoryArchiveFileName("2026-06-07-09-03", 1)).toBe("2026-06-07-09-03-rev-01.md")
    expect(draftHistoryArchiveFileName("2026-06-07-09-03", 12)).toBe("2026-06-07-09-03-rev-12.md")
  })

  it("parses the revision from a valid archive file name", () => {
    expect(parseDraftHistoryRevision("2026-06-07-09-03-rev-04.md")).toBe(4)
  })

  it("returns undefined for names that are not archive files", () => {
    expect(parseDraftHistoryRevision("01-intro.md")).toBeUndefined()
    expect(parseDraftHistoryRevision("2026-06-07-09-03-rev-04.txt")).toBeUndefined()
    expect(parseDraftHistoryRevision("2026-06-07-rev-04.md")).toBeUndefined()
  })

  it("computes the next revision as max existing + 1", () => {
    expect(nextDraftHistoryRevision([])).toBe(1)
    expect(
      nextDraftHistoryRevision([
        "2026-06-07-09-03-rev-01.md",
        "2026-06-07-10-30-rev-03.md",
        "notes.md"
      ])
    ).toBe(4)
  })
})

interface FakeFileSystem extends DraftHistoryFileSystem {
  readonly writes: Map<string, Uint8Array>
}

function createFakeFileSystem(options: {
  readonly draftExists: boolean
  readonly draftBytes?: Uint8Array
  readonly historyNames?: readonly string[]
}): FakeFileSystem {
  const writes = new Map<string, Uint8Array>()
  const createDirectory = vi.fn(async (): Promise<void> => undefined)

  return {
    writes,
    createDirectory,
    exists: async () => options.draftExists,
    readFile: async () => options.draftBytes ?? new Uint8Array(),
    writeFile: async (uri, content): Promise<void> => {
      writes.set(String(uri), content)
    },
    listFileNames: async () => options.historyNames ?? []
  }
}

describe("archiveExistingDraft", () => {
  it("does nothing when the live draft does not exist", async () => {
    const fileSystem = createFakeFileSystem({ draftExists: false })

    const result = await archiveExistingDraft({
      draftUri: "draft/01-intro.md",
      historyDirectory: ".draft/01-intro",
      resolveArchiveUri: (fileName) => `.draft/01-intro/${fileName}`,
      fileSystem
    })

    expect(result).toBeUndefined()
    expect(fileSystem.writes.size).toBe(0)
    expect(fileSystem.createDirectory).not.toHaveBeenCalled()
  })

  it("archives the existing draft bytes as revision 01 when history is empty", async () => {
    const draftBytes = new TextEncoder().encode("이전 초안")
    const fileSystem = createFakeFileSystem({ draftExists: true, draftBytes })

    const result = await archiveExistingDraft({
      draftUri: "draft/01-intro.md",
      historyDirectory: ".draft/01-intro",
      resolveArchiveUri: (fileName) => `.draft/01-intro/${fileName}`,
      fileSystem,
      now: new Date(2026, 5, 7, 9, 3)
    })

    expect(result).toBe("2026-06-07-09-03-rev-01.md")
    expect(fileSystem.createDirectory).toHaveBeenCalledWith(".draft/01-intro")
    expect(fileSystem.writes.get(".draft/01-intro/2026-06-07-09-03-rev-01.md")).toEqual(draftBytes)
  })

  it("increments the revision past the highest existing archive", async () => {
    const fileSystem = createFakeFileSystem({
      draftExists: true,
      historyNames: ["2026-06-01-08-00-rev-01.md", "2026-06-02-08-00-rev-02.md"]
    })

    const result = await archiveExistingDraft({
      draftUri: "draft/01-intro.md",
      historyDirectory: ".draft/01-intro",
      resolveArchiveUri: (fileName) => `.draft/01-intro/${fileName}`,
      fileSystem,
      now: new Date(2026, 5, 7, 9, 3)
    })

    expect(result).toBe("2026-06-07-09-03-rev-03.md")
  })
})
