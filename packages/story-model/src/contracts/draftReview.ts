import { z } from 'zod';

import { parseJsonArray } from './aiResponseParser';

export type CritiqueCategory = 'voice' | 'purpose' | 'repetition';

export const critiqueCategories: readonly [CritiqueCategory, ...CritiqueCategory[]] = [
  'voice',
  'purpose',
  'repetition',
];

export type Severity = 'high' | 'low';

export const severities: readonly [Severity, ...Severity[]] = ['high', 'low'];

export interface DraftCritiqueIssue {
  readonly category: CritiqueCategory;
  readonly severity: Severity;
  readonly excerpt?: string;
  readonly comment: string;
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

const draftCritiqueIssueSchema: z.ZodType<DraftCritiqueIssue> = z.object({
  category: z.enum(critiqueCategories),
  severity: z.enum(severities).default('low'),
  excerpt: z.string().trim().min(1).optional(),
  comment: z.string().trim().min(1),
  sceneStem: z.string().trim().min(1).optional(),
});

export function coerceCritiqueIssues(rawText: string): DraftCritiqueIssue[] {
  const parsedArray: unknown[] | null = parseJsonArray(rawText);

  if (!parsedArray) {
    return [];
  }

  return parsedArray.flatMap((item) => {
    const parsed: z.ZodSafeParseResult<DraftCritiqueIssue> =
      draftCritiqueIssueSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

export function countBlockingIssues(
  continuityIssues: readonly ContinuityIssueLike[],
  critiqueIssues: readonly DraftCritiqueIssue[],
): number {
  const blockingContinuity: number = continuityIssues.filter(
    (issue) => issue.severity === 'high',
  ).length;
  const blockingCritique: number = critiqueIssues.filter(
    (issue) => issue.severity === 'high',
  ).length;
  return blockingContinuity + blockingCritique;
}

export interface CritiqueScore {
  readonly overall: number;
  readonly perCategory: Record<CritiqueCategory, number>;
  readonly issueCount: number;
}

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
  const perCategory: Record<CritiqueCategory, number> = Object.fromEntries(
    critiqueCategories.map((category) => [category, 0]),
  ) as Record<CritiqueCategory, number>;

  for (const issue of critiqueIssues) {
    perCategory[issue.category] += critiqueScoring.deduction[issue.category][issue.severity];
  }

  const totalDeduction: number = critiqueCategories.reduce(
    (total, category) => total + perCategory[category],
    0,
  );
  const overall: number = Math.max(
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
    const label: string = critiqueCategoryLabels[issue.category];
    const excerpt: string = issue.excerpt ? ` ("${issue.excerpt}")` : '';
    instructions.push(`${label}${excerpt}: ${issue.comment}`);
  }

  return instructions;
}
