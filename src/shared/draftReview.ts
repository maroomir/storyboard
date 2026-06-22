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

export interface CritiqueScore {
  readonly overall: number
  readonly perCategory: Record<CritiqueCategory, number>
  readonly issueCount: number
}

const baseCritiqueScore = 100

const critiqueDeduction: Record<CritiqueCategory, Record<Severity, number>> = {
  purpose: { high: 15, low: 5 },
  voice: { high: 12, low: 4 },
  repetition: { high: 8, low: 3 }
}

export function scoreCritique(critiqueIssues: readonly DraftCritiqueIssue[]): CritiqueScore {
  const perCategory: Record<CritiqueCategory, number> = { voice: 0, purpose: 0, repetition: 0 }

  for (const issue of critiqueIssues) {
    perCategory[issue.category] += critiqueDeduction[issue.category][issue.severity]
  }

  const totalDeduction = perCategory.voice + perCategory.purpose + perCategory.repetition
  const overall = Math.max(0, Math.min(baseCritiqueScore, baseCritiqueScore - totalDeduction))

  return { overall, perCategory, issueCount: critiqueIssues.length }
}

export function shouldPassRevise(input: {
  readonly blocking: number
  readonly score: number
  readonly threshold: number
  readonly highContinuityCount: number
}): boolean {
  if (input.blocking === 0) {
    return true
  }
  return input.threshold > 0 && input.score >= input.threshold && input.highContinuityCount === 0
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
