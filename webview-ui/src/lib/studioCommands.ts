import {
  Expand,
  FileText,
  GitCompare,
  Layers,
  type LucideIcon,
  RefreshCw,
  Sparkles,
  SpellCheck,
  TextSelect,
  Wand2,
  WrapText,
} from "lucide-react"

import { availableStudioActions, type StudioIntent } from "./studioIntent"
import type { StudioActionId, StudioTarget } from "./types"

export interface StudioSlashCommand {
  readonly command: string
  readonly action: StudioActionId
}

export const studioSlashCommands: readonly StudioSlashCommand[] = [
  { command: "regenerate", action: "regenerate" },
  { command: "generate", action: "generate" },
  { command: "format", action: "applyFormat" },
  { command: "grammar", action: "grammarCheck" },
  { command: "continuity", action: "continuityCheck" },
  { command: "expand", action: "expand" },
  { command: "augment", action: "augment" },
  { command: "augment-selection", action: "augmentSelection" },
  { command: "edit", action: "editSelection" },
  { command: "condense", action: "condense" },
  { command: "complete", action: "completeStory" },
  { command: "cards", action: "buildCardsFromScenes" },
]

export function actionLabel(action: StudioActionId): string {
  switch (action) {
    case "regenerate":
      return "재생성"
    case "generate":
      return "초안 생성"
    case "applyFormat":
      return "형식 적용"
    case "grammarCheck":
      return "문법 검사"
    case "continuityCheck":
      return "연속성 검사"
    case "expand":
      return "선택 영역 확장"
    case "augment":
      return "카드 기반 보충"
    case "augmentSelection":
      return "선택 영역 보충"
    case "editSelection":
      return "선택 영역 편집"
    case "condense":
      return "원본 축소"
    case "completeStory":
      return "이야기 완결"
    case "buildCardsFromScenes":
      return "씬 기반 카드 구성"
  }
}

export function actionIcon(action: StudioActionId): LucideIcon {
  switch (action) {
    case "regenerate":
      return RefreshCw
    case "generate":
      return Sparkles
    case "applyFormat":
      return WrapText
    case "grammarCheck":
      return SpellCheck
    case "continuityCheck":
      return GitCompare
    case "expand":
      return Expand
    case "augment":
      return Layers
    case "augmentSelection":
      return TextSelect
    case "editSelection":
      return Wand2
    case "condense":
      return WrapText
    case "completeStory":
      return FileText
    case "buildCardsFromScenes":
      return Layers
  }
}

function slashAvailableActions(target: StudioTarget): readonly StudioActionId[] {
  const actions = availableStudioActions(target)

  if (target.kind === "draft" && target.hasSelection && !actions.includes("editSelection")) {
    return [...actions, "editSelection"]
  }

  return actions
}

export function slashMenuState(value: string): { readonly token: string } | undefined {
  const match = /^\/(\S*)$/.exec(value)
  return match ? { token: match[1] } : undefined
}

export function slashCandidates(
  token: string,
  target: StudioTarget,
): readonly StudioSlashCommand[] {
  const available = slashAvailableActions(target)
  const lowered = token.toLowerCase()

  return studioSlashCommands.filter((entry) => {
    if (!available.includes(entry.action)) {
      return false
    }

    if (lowered.length === 0) {
      return true
    }

    return entry.command.startsWith(lowered) || actionLabel(entry.action).includes(token)
  })
}

export function parseSlashInput(text: string, target: StudioTarget): StudioIntent | undefined {
  if (!text.startsWith("/")) {
    return undefined
  }

  const withoutSlash = text.slice(1)
  const separatorIndex = withoutSlash.search(/\s/)
  const command =
    separatorIndex === -1 ? withoutSlash : withoutSlash.slice(0, separatorIndex)
  const instruction =
    separatorIndex === -1 ? "" : withoutSlash.slice(separatorIndex + 1).trim()

  const entry = studioSlashCommands.find((candidate) => candidate.command === command.toLowerCase())

  if (!entry) {
    return { kind: "clarify", reason: "ambiguous", suggestions: availableStudioActions(target) }
  }

  if (!slashAvailableActions(target).includes(entry.action)) {
    return {
      kind: "clarify",
      reason: unavailableReason(entry.action, target),
      suggestions: availableStudioActions(target),
    }
  }

  return instruction.length === 0
    ? { kind: "action", action: entry.action }
    : { kind: "action", action: entry.action, instruction }
}

function unavailableReason(
  action: StudioActionId,
  target: StudioTarget,
): "no-target" | "needs-selection" | "needs-draft" | "ambiguous" {
  if (target.kind === "none") {
    return "no-target"
  }

  if (
    (action === "expand" || action === "augmentSelection" || action === "editSelection") &&
    !target.hasSelection
  ) {
    return "needs-selection"
  }

  if (action === "applyFormat" && target.kind === "scene" && !target.draftExists) {
    return "needs-draft"
  }

  return "ambiguous"
}
