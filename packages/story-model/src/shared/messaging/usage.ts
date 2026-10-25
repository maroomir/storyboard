import type { UsageAmount, UsageSummaryByEntity } from '#model/contracts/ai';
import { z } from 'zod';

const usageAmountSchema: z.ZodType<UsageAmount> = z.object({
  costUsd: z.number(),
  tokens: z.number(),
  hasUnpricedUsage: z.boolean(),
  cache: z
    .object({ promptTokens: z.number(), cachedTokens: z.number(), savedUsd: z.number() })
    .optional(),
});

const usageSummaryByEntitySchema: z.ZodType<UsageSummaryByEntity> = z.object({
  scenes: z.record(z.string(), usageAmountSchema),
  characters: z.record(z.string(), usageAmountSchema),
  backgrounds: z.record(z.string(), usageAmountSchema),
  total: usageAmountSchema,
});

export interface UsageReadRequestPayload {
  [key: string]: never;
}

export const usageReadRequestPayloadSchema: z.ZodType<UsageReadRequestPayload> = z.object({});

export const usageReadResponsePayloadSchema: z.ZodType<UsageSummaryByEntity> =
  usageSummaryByEntitySchema;
