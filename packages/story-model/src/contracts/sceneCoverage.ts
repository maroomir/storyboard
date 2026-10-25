import { z } from 'zod';

import { parseJsonArray } from './aiResponseParser';

export type CoverageStatus = 'missing' | 'out-of-order';

export const coverageStatuses: readonly [CoverageStatus, ...CoverageStatus[]] = [
  'missing',
  'out-of-order',
];

export interface SceneCoverageIssue {
  readonly index: number;
  readonly status: CoverageStatus;
  readonly note?: string;
}

const sceneCoverageIssueSchema: z.ZodType<SceneCoverageIssue> = z.object({
  index: z.number().int().min(1),
  status: z.enum(coverageStatuses),
  note: z.string().trim().min(1).optional(),
});

export function coerceSceneCoverage(rawText: string, beatCount: number): SceneCoverageIssue[] {
  const parsedArray: unknown[] | null = parseJsonArray(rawText);

  if (!parsedArray) {
    return [];
  }

  const seen: Set<string> = new Set<string>();
  return parsedArray.flatMap((item) => {
    const parsed: z.ZodSafeParseResult<SceneCoverageIssue> =
      sceneCoverageIssueSchema.safeParse(item);
    if (!parsed.success || parsed.data.index > beatCount) {
      return [];
    }

    const key: string = `${parsed.data.index}:${parsed.data.status}`;
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
  const missing: number[] = issues
    .filter((issue) => issue.status === 'missing')
    .map((issue) => issue.index)
    .sort(byIndex);
  const outOfOrder: number[] = issues
    .filter((issue) => issue.status === 'out-of-order')
    .map((issue) => issue.index)
    .sort(byIndex);
  const coveredRatio: number = totalBeats === 0 ? 1 : (totalBeats - missing.length) / totalBeats;

  return { totalBeats, missing, outOfOrder, coveredRatio };
}
