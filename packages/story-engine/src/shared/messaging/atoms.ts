import { z } from 'zod';

import { aiProviderIds, aiTaskNames } from '@storyboard/story-model/contracts';

export const storyboardMessageProtocolVersion = '1.0.0';

export const requestIdSchema = z.string().trim().min(1);
export const methodSchema = z.string().trim().min(1);
export const uriStringSchema = z.string().trim().min(1);
export const providerIdSchema = z.enum(aiProviderIds);
export const aiTaskNameSchema = z.enum(aiTaskNames);
