import { z } from 'zod';

const usageAmountSchema = z.object({
  costUsd: z.number(),
  tokens: z.number(),
  hasUnpricedUsage: z.boolean(),
});

const usageSummaryByEntitySchema = z.object({
  scenes: z.record(z.string(), usageAmountSchema),
  characters: z.record(z.string(), usageAmountSchema),
  backgrounds: z.record(z.string(), usageAmountSchema),
  total: usageAmountSchema,
});

export const usageReadRequestPayloadSchema = z.object({});

export const usageReadResponsePayloadSchema = usageSummaryByEntitySchema;
