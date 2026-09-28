import { describe, expect, it } from "vitest"

import { StudioAgentPrompt, type StudioAgentPromptInput } from "@storyboard/story-ai"

describe("StudioAgentPrompt golden", () => {
  const draft: StudioAgentPromptInput = {
    entityKind: "scene",
    patchShape: "draft",
    entityLabel: "3. 항구의 밤",
    targetFile: "draft/03-harbor.md",
    context: "[초안]\n엘리아가 항구에 도착했다.\n\n[작가가 선택한 구간]\n항구",
    conversation: "작가: 좀 더 길게\n조수: 어느 부분을요?",
    instruction: "도착 장면을 늘려 줘",
    canAsk: true,
    canLookup: true,
    canInvoke: true,
    hasSelection: true
  }
  const sceneCard: StudioAgentPromptInput = {
    ...draft,
    patchShape: "sceneCard",
    targetFile: "scene/03-harbor.card"
  }
  const characterCard: StudioAgentPromptInput = {
    ...draft,
    entityKind: "character",
    patchShape: "entityCard",
    entityLabel: "엘리아",
    targetFile: "character/elia.card"
  }
  const exhausted = { canAsk: false, canLookup: false, canInvoke: false } as const

  it("renders a draft edit with every allowance and a selection", () => {
    expect(StudioAgentPrompt.build(draft)).toMatchSnapshot()
  })

  it("renders a draft edit without a selection or a conversation", () => {
    expect(StudioAgentPrompt.build({ ...draft, hasSelection: false, conversation: "" })).toMatchSnapshot()
  })

  it("renders a draft edit with every allowance used up", () => {
    expect(StudioAgentPrompt.build({ ...draft, ...exhausted })).toMatchSnapshot()
    expect(StudioAgentPrompt.build({ ...draft, ...exhausted, pinnedTool: "expand" })).toMatchSnapshot()
  })

  it.each([
    ["a span tool with a selection", { pinnedTool: "expand", hasSelection: true }],
    ["a span tool without a selection", { pinnedTool: "augment", hasSelection: false }],
    ["a whole-draft tool", { pinnedTool: "grammarCheck", hasSelection: false }]
  ] as const)("renders a draft edit pinned to %s", (_label, overrides) => {
    expect(StudioAgentPrompt.build({ ...draft, ...overrides })).toMatchSnapshot()
  })

  it("renders a scene card edit", () => {
    expect(StudioAgentPrompt.build(sceneCard)).toMatchSnapshot()
    expect(StudioAgentPrompt.build({ ...sceneCard, pinnedTool: "cardAudit" })).toMatchSnapshot()
    expect(StudioAgentPrompt.build({ ...sceneCard, ...exhausted, hasSelection: false })).toMatchSnapshot()
  })

  it("renders an entity card edit", () => {
    expect(StudioAgentPrompt.build(characterCard)).toMatchSnapshot()
    expect(StudioAgentPrompt.build({ ...characterCard, pinnedTool: "collectFromDrafts" })).toMatchSnapshot()
    expect(
      StudioAgentPrompt.build({ ...characterCard, ...exhausted, entityKind: "background", conversation: "" })
    ).toMatchSnapshot()
  })
})
