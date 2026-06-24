import { z } from "zod"

const usageSummaryByEntitySchema = z.object({
  scenes: z.record(z.string(), z.number()),
  characters: z.record(z.string(), z.number()),
  backgrounds: z.record(z.string(), z.number()),
  totalUsd: z.number()
})

export const usageReadRequestPayloadSchema = z.object({})

export const usageReadResponsePayloadSchema = usageSummaryByEntitySchema
