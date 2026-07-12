import { z } from 'zod';

import { parseJsonArray } from './ai-response-parser';

export const coverageStatuses = ['missing', 'out-of-order'] as const;

export type CoverageStatus = (typeof coverageStatuses)[number];

export interface SceneCoverageIssue {
  readonly index: number;
  readonly status: CoverageStatus;
  readonly note?: string;
}

const sceneCoverageIssueSchema = z.object({
  index: z.number().int().min(1),
  status: z.enum(coverageStatuses),
  note: z.string().trim().min(1).optional(),
});

export function coerceSceneCoverage(rawText: string, beatCount: number): SceneCoverageIssue[] {
  const parsedArray = parseJsonArray(rawText);

  if (!parsedArray) {
    return [];
  }

  const seen = new Set<string>();
  return parsedArray.flatMap((item) => {
    const parsed = sceneCoverageIssueSchema.safeParse(item);
    if (!parsed.success || parsed.data.index > beatCount) {
      return [];
    }

    const key = `${parsed.data.index}:${parsed.data.status}`;
    if (seen.has(key)) {
      return [];
    }
    seen.add(key);
    return [parsed.data];
  });
}

export interface SceneCoverageReport {
  readonly totalBeats: number;
  readonly missing: readonly number[];
  readonly outOfOrder: readonly number[];
  readonly coveredRatio: number;
}

export function summarizeSceneCoverage(
  issues: readonly SceneCoverageIssue[],
  totalBeats: number,
): SceneCoverageReport {
  const byIndex = (a: number, b: number): number => a - b;
  const missing = issues
    .filter((issue) => issue.status === 'missing')
    .map((issue) => issue.index)
    .sort(byIndex);
  const outOfOrder = issues
    .filter((issue) => issue.status === 'out-of-order')
    .map((issue) => issue.index)
    .sort(byIndex);
  const coveredRatio = totalBeats === 0 ? 1 : (totalBeats - missing.length) / totalBeats;

  return { totalBeats, missing, outOfOrder, coveredRatio };
}
