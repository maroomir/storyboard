import { readFile } from 'node:fs/promises';

import { z } from 'zod';

export type SimPromptVariant = 'generic' | 'xs' | 'rich';

export const simPromptVariants: readonly [SimPromptVariant, ...SimPromptVariant[]] = ['generic', 'xs', 'rich'];

export const promptVariantSchema: z.ZodType<SimPromptVariant> = z.enum(simPromptVariants);

interface Selection {
  provider: string;
  model: string;
  promptVariant?: SimPromptVariant;
}

const selectionSchema: z.ZodType<Selection> = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  promptVariant: promptVariantSchema.optional(),
});

export interface SimConfig {
  generation?: Selection;
  judge?: Selection;
  ollama?: { baseUrl?: string; contextTokens?: number; think?: boolean };
  repeats?: number;
}

export const simConfigSchema: z.ZodType<SimConfig> = z.object({
  generation: selectionSchema.optional(),
  judge: selectionSchema.optional(),
  ollama: z
    .object({
      baseUrl: z.string().min(1).optional(),
      contextTokens: z.number().int().positive().optional(),
      think: z.boolean().optional(),
    })
    .optional(),
  repeats: z.number().int().positive().optional(),
});

export const simConfigFileName: string = 'sim.config.json';

export function parseSimConfig(raw: unknown): SimConfig {
  return simConfigSchema.parse(raw);
}

export async function readSimConfig(filePath: string): Promise<SimConfig> {
  let raw: string;

  try {
    raw = await readFile(filePath, 'utf8');
  } catch {
    return {};
  }

  return parseSimConfig(JSON.parse(raw));
}
