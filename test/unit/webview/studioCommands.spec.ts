import { describe, expect, it } from "vitest"

import {
  parseSlashInput,
  slashCandidates,
  slashMenuState,
} from "@webview/lib/studioCommands"
import type { StudioTarget } from "@webview/lib/types"

const draftTarget: StudioTarget = {
  kind: "draft",
  label: "01-intro.md",
  sceneUri: "file:///scene/01-intro.txt",
  draftUri: "file:///draft/01-intro.md",
  hasSelection: false,
}

const projectTarget: StudioTarget = { kind: "project", label: "내 소설", hasSelection: false }

describe("slashMenuState", () => {
  it("opens while typing a command with no space", () => {
    expect(slashMenuState("/gr")).toEqual({ token: "gr" })
    expect(slashMenuState("/")).toEqual({ token: "" })
  })

  it("closes once a space follows the command", () => {
    expect(slashMenuState("/grammar ")).toBeUndefined()
    expect(slashMenuState("맞춤법")).toBeUndefined()
  })
})

describe("slashCandidates", () => {
  it("filters by command prefix", () => {
    const candidates = slashCandidates("gr", draftTarget)
    expect(candidates.map((entry) => entry.command)).toEqual(["grammar"])
  })

  it("also matches by Korean label", () => {
    const candidates = slashCandidates("문법", draftTarget)
    expect(candidates.map((entry) => entry.action)).toContain("grammarCheck")
  })

  it("respects the target's available actions", () => {
    const commands = slashCandidates("", projectTarget).map((entry) => entry.action)
    expect(commands).toEqual(["completeStory", "buildCardsFromScenes"])
  })

  it("offers editSelection only when a draft selection exists", () => {
    expect(slashCandidates("edit", draftTarget)).toHaveLength(0)
    const withSelection = slashCandidates("edit", { ...draftTarget, hasSelection: true })
    expect(withSelection.map((entry) => entry.action)).toEqual(["editSelection"])
  })
})

describe("parseSlashInput", () => {
  it("returns undefined for non-slash text so the keyword path runs", () => {
    expect(parseSlashInput("맞춤법 봐줘", draftTarget)).toBeUndefined()
  })

  it("extracts the action and trailing instruction", () => {
    expect(parseSlashInput("/edit 더 서정적으로", { ...draftTarget, hasSelection: true })).toEqual({
      kind: "action",
      action: "editSelection",
      instruction: "더 서정적으로",
    })
  })

  it("omits the instruction when only the command is typed", () => {
    expect(parseSlashInput("/grammar", draftTarget)).toEqual({
      kind: "action",
      action: "grammarCheck",
    })
  })

  it("clarifies an unknown command", () => {
    const intent = parseSlashInput("/nope", draftTarget)
    expect(intent).toMatchObject({ kind: "clarify", reason: "ambiguous" })
  })

  it("clarifies a known command that needs a selection", () => {
    const intent = parseSlashInput("/expand", draftTarget)
    expect(intent).toMatchObject({ kind: "clarify", reason: "needs-selection" })
  })
})
