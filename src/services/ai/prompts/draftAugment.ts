import {
  formatCardAttributes,
  joinCardText,
  type BackgroundCard,
  type CharacterCard
} from "@/shared/card"
import type { ProjectFormat } from "@/shared/project"
import { type PromptArtifact, type PromptVariantId } from "./types"

export type DraftAugmentScope = "draft" | "selection"

export interface DraftAugmentInput {
  readonly target: string
  readonly scope: DraftAugmentScope
  readonly format: ProjectFormat
  readonly cards: readonly string[]
  readonly facts: readonly string[]
  readonly intent?: string
}

export const DraftAugmentPrompt = {
  config: {
    temperature: 0.7,
    maxTokens: 4000
  },
  build(input: DraftAugmentInput, variant: PromptVariantId = "generic"): PromptArtifact {
    return variant === "xs" ? buildXs(input) : buildGeneric(input)
  }
} as const

function buildGeneric(input: DraftAugmentInput): PromptArtifact {
  return {
    system: [
      "갱신된 설정 카드를 기존 본문에 자연스럽게 녹여 보충하는 한국어 장편 소설 작가다.",
      "[카드]와 [설정]의 정보를 반영해 묘사·감정·디테일을 보충하되, 기존 문장·사건 전개·문체와 사용자가 직접 고친 부분은 최대한 보존하라.",
      "장면의 사건 순서와 구조는 바꾸지 말고, [카드]·[설정]에 없는 새 사실은 지어내지 마라.",
      input.scope === "selection"
        ? "주어진 [선택 영역]만 보충하고 그 외 본문은 건드리지 마라."
        : "[본문] 전체를 보충하라.",
      input.format === "novel" ? "대사는 따옴표를 사용하고 산문체를 유지하라." : undefined,
      "설명·머리말 없이 보충된 본문만 출력하라."
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n"),
    user: buildUserBlock(input)
  }
}

function buildXs(input: DraftAugmentInput): PromptArtifact {
  const targetLabel = input.scope === "selection" ? "[선택 영역]" : "본문"
  return {
    system: `[카드]·[설정]을 반영해 ${targetLabel}을 보충하라. 전개·문체 유지, 새 설정 금지, 보충된 본문만 출력.`,
    user: buildUserBlock(input)
  }
}

export function formatAugmentCards(
  characters: readonly CharacterCard[],
  background: BackgroundCard | undefined
): string[] {
  const blocks: string[] = []

  for (const character of characters) {
    const lines = [`[${character.name}] 역할: ${character.role ?? "extra"}`]
    appendCardLine(lines, "말투", joinCardText(character.voice))
    appendCardLine(lines, "설명", joinCardText(character.description))
    appendCardLine(lines, "욕망", joinCardText(character.desire))
    appendCardLine(lines, "특징", (character.traits ?? []).join(", "))
    appendCardLine(lines, "속성", formatCardAttributes(character.attributes))
    blocks.push(lines.join("\n"))
  }

  if (background) {
    const header = [`[배경: ${background.name}]`, background.time, background.weather]
      .filter((part): part is string => Boolean(part && part.trim().length > 0))
      .join(" ")
    const lines = [header]
    appendCardLine(lines, "묘사", joinCardText(background.description))
    appendCardLine(lines, "감각", joinCardText(background.senses))
    blocks.push(lines.join("\n"))
  }

  return blocks
}

function appendCardLine(lines: string[], label: string, value: string): void {
  if (value.trim().length > 0) {
    lines.push(`${label}: ${value}`)
  }
}

function buildUserBlock(input: DraftAugmentInput): string {
  const sections: string[] = []

  if (input.cards.length > 0) {
    sections.push(`[카드]\n${input.cards.join("\n\n")}`)
  }
  if (input.facts.length > 0) {
    sections.push(`[설정]\n${input.facts.map((line) => `- ${line}`).join("\n")}`)
  }

  const intent = input.intent?.trim()
  if (intent) {
    sections.push(`[장면 의도]\n${intent}`)
  }

  sections.push(`${input.scope === "selection" ? "[선택 영역]" : "[본문]"}\n${input.target}`)

  return sections.join("\n\n")
}
