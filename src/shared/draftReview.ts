import { z } from "zod"

import { parseJsonArray } from "@/utils/aiResponseParser"

export const critiqueCategories = ["voice", "purpose", "repetition"] as const

export type CritiqueCategory = (typeof critiqueCategories)[number]

export const severities = ["high", "low"] as const

export type Severity = (typeof severities)[number]

export interface DraftCritiqueIssue {
  readonly category: CritiqueCategory
  readonly severity: Severity
  readonly excerpt?: string
  readonly comment: string
}

export interface ContinuityIssueLike {
  readonly original: string
  readonly reason: string
  readonly severity: Severity
}

const critiqueCategoryLabels: Record<CritiqueCategory, string> = {
  voice: "캐릭터 보이스",
  purpose: "장면 목적",
  repetition: "반복"
}

const draftCritiqueIssueSchema = z.object({
  category: z.enum(critiqueCategories),
  severity: z.enum(severities).default("low"),
  excerpt: z.string().trim().min(1).optional(),
  comment: z.string().trim().min(1)
})

export function coerceCritiqueIssues(rawText: string): DraftCritiqueIssue[] {
  const parsedArray = parseJsonArray(rawText)

  if (!parsedArray) {
    return []
  }

  return parsedArray.flatMap((item) => {
    const parsed = draftCritiqueIssueSchema.safeParse(item)
    return parsed.success ? [parsed.data] : []
  })
}

export function countBlockingIssues(
  continuityIssues: readonly ContinuityIssueLike[],
  critiqueIssues: readonly DraftCritiqueIssue[]
): number {
  const blockingContinuity = continuityIssues.filter((issue) => issue.severity === "high").length
  const blockingCritique = critiqueIssues.filter((issue) => issue.severity === "high").length
  return blockingContinuity + blockingCritique
}

export function buildRevisionInstructions(
  continuityIssues: readonly ContinuityIssueLike[],
  critiqueIssues: readonly DraftCritiqueIssue[]
): string[] {
  const instructions: string[] = []

  for (const issue of continuityIssues) {
    instructions.push(`설정 모순: "${issue.original}" — ${issue.reason}`)
  }

  for (const issue of critiqueIssues) {
    const label = critiqueCategoryLabels[issue.category]
    const excerpt = issue.excerpt ? ` ("${issue.excerpt}")` : ""
    instructions.push(`${label}${excerpt}: ${issue.comment}`)
  }

  return instructions
}
