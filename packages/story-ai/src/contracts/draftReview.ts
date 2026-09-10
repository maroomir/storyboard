import { z } from 'zod';

import { parseJsonArray } from './aiResponseParser';

export const critiqueCategories = ['voice', 'purpose', 'repetition'] as const;

export type CritiqueCategory = (typeof critiqueCategories)[number];

export const severities = ['high', 'low'] as const;

export type Severity = (typeof severities)[number];

export interface DraftCritiqueIssue {
  readonly category: CritiqueCategory;
  readonly severity: Severity;
  readonly excerpt?: string;
  readonly comment: string;
  // Present only when the critiqued body carried scene markers, as the final review's does.
  readonly sceneStem?: string;
}

export interface ContinuityIssueLike {
  readonly original: string;
  readonly reason: string;
  readonly severity: Severity;
  readonly sceneStem?: string;
}

export const critiqueCategoryLabels: Record<CritiqueCategory, string> = {
  voice: '캐릭터 보이스',
  purpose: '장면 목적',
  repetition: '반복',
};

const draftCritiqueIssueSchema = z.object({
  category: z.enum(critiqueCategories),
  severity: z.enum(severities).default('low'),
  excerpt: z.string().trim().min(1).optional(),
  comment: z.string().trim().min(1),
  sceneStem: z.string().trim().min(1).optional(),
});

export function coerceCritiqueIssues(rawText: string): DraftCritiqueIssue[] {
  const parsedArray = parseJsonArray(rawText);

  if (!parsedArray) {
    return [];
  }

  return parsedArray.flatMap((item) => {
    const parsed = draftCritiqueIssueSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

export function countBlockingIssues(
  continuityIssues: readonly ContinuityIssueLike[],
  critiqueIssues: readonly DraftCritiqueIssue[],
): number {
  const blockingContinuity = continuityIssues.filter((issue) => issue.severity === 'high').length;
  const blockingCritique = critiqueIssues.filter((issue) => issue.severity === 'high').length;
  return blockingContinuity + blockingCritique;
}

export interface CritiqueScore {
  readonly overall: number;
  readonly perCategory: Record<CritiqueCategory, number>;
  readonly issueCount: number;
}

// 검수 점수의 저울. 만점에서 문제마다 깎는다. 장면 목적이 가장 무겁고 반복이 가장 가볍다 —
// 목적이 없는 씬은 다시 써야 하지만 반복은 다듬어 고칠 수 있기 때문이다.
export const critiqueScoring: {
  readonly baseScore: number;
  readonly deduction: Record<CritiqueCategory, Record<Severity, number>>;
} = {
  baseScore: 100,
  deduction: {
    purpose: { high: 15, low: 5 },
    voice: { high: 12, low: 4 },
    repetition: { high: 8, low: 3 },
  },
};

export function scoreCritique(critiqueIssues: readonly DraftCritiqueIssue[]): CritiqueScore {
  const perCategory = Object.fromEntries(
    critiqueCategories.map((category) => [category, 0]),
  ) as Record<CritiqueCategory, number>;

  for (const issue of critiqueIssues) {
    perCategory[issue.category] += critiqueScoring.deduction[issue.category][issue.severity];
  }

  const totalDeduction = critiqueCategories.reduce(
    (total, category) => total + perCategory[category],
    0,
  );
  const overall = Math.max(
    0,
    Math.min(critiqueScoring.baseScore, critiqueScoring.baseScore - totalDeduction),
  );

  return { overall, perCategory, issueCount: critiqueIssues.length };
}

export function shouldPassRevise(input: {
  readonly blocking: number;
  readonly score: number;
  readonly threshold: number;
  readonly highContinuityCount: number;
}): boolean {
  if (input.blocking === 0) {
    return true;
  }
  return input.threshold > 0 && input.score >= input.threshold && input.highContinuityCount === 0;
}

export function buildRevisionInstructions(
  continuityIssues: readonly ContinuityIssueLike[],
  critiqueIssues: readonly DraftCritiqueIssue[],
): string[] {
  const instructions: string[] = [];

  for (const issue of continuityIssues) {
    instructions.push(`설정 모순: "${issue.original}" — ${issue.reason}`);
  }

  for (const issue of critiqueIssues) {
    const label = critiqueCategoryLabels[issue.category];
    const excerpt = issue.excerpt ? ` ("${issue.excerpt}")` : '';
    instructions.push(`${label}${excerpt}: ${issue.comment}`);
  }

  return instructions;
}
