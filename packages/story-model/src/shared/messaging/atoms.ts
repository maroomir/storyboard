import { z } from 'zod';

import { aiProviderIds, type AiProviderId } from '#model/contracts/providerCatalog';
import { aiTaskNames, type AiTaskName } from '#model/contracts/ai';

export const storyboardMessageProtocolVersion: string = '1.0.0';

export const requestIdSchema: z.ZodType<string> = z.string().trim().min(1);
export const methodSchema: z.ZodType<string> = z.string().trim().min(1);
export const uriStringSchema: z.ZodType<string> = z.string().trim().min(1);
export type ProviderId = AiProviderId;

export const providerIdSchema: z.ZodType<ProviderId> = z.enum(aiProviderIds);
export const aiTaskNameSchema: z.ZodType<AiTaskName> = z.enum(aiTaskNames);
