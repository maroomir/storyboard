import { z } from 'zod';

import { storyboardModelCatalog } from '@storyboard/story-ai';
import { aiProviderStatusSchema } from './ai';
import { aiTaskNameSchema, providerIdSchema } from './atoms';

const providerModelOptionSchema = z.object({
  id: z.string().trim().min(1),
  displayName: z.string().trim().min(1),
});

const storyboardModelCatalogPayloadSchema = z.record(
  providerIdSchema,
  z.array(providerModelOptionSchema).min(1),
);

const providerRuntimeConfigSchema = z.object({
  model: z.string().trim().min(1),
  baseUrl: z.string().trim().min(1).optional(),
  command: z.string().trim().min(1).optional(),
});

const providerConfigsPayloadSchema = z.record(providerIdSchema, providerRuntimeConfigSchema);

const taskAssignmentReadSchema = z
  .object({
    providerId: providerIdSchema.nullable(),
    model: z.string().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.providerId === null && data.model !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'taskAssignments: model must be null when providerId is null.',
      });
    }
  });

const taskAssignmentsPayloadSchema = z.record(aiTaskNameSchema, taskAssignmentReadSchema);
const aiTaskStatusSchema = z.enum(['wired', 'planned']);
const taskCatalogEntrySchema = z.object({
  name: aiTaskNameSchema,
  label: z.string().trim().min(1),
  status: aiTaskStatusSchema,
});

export const settingsReadResponsePayloadSchema = z.object({
  defaultProvider: providerIdSchema,
  providers: z.array(aiProviderStatusSchema),
  providerConfigs: providerConfigsPayloadSchema,
  taskAssignments: taskAssignmentsPayloadSchema,
  modelCatalog: storyboardModelCatalogPayloadSchema,
  taskCatalog: z.array(taskCatalogEntrySchema).min(1),
});

export const settingsChangedEventPayloadSchema = settingsReadResponsePayloadSchema;

export const settingsReadRequestPayloadSchema = z.object({});

export const settingsUpdateDefaultProviderRequestPayloadSchema = z.object({
  providerId: providerIdSchema,
});

export const settingsUpdateProviderModelRequestPayloadSchema = z
  .object({
    providerId: providerIdSchema,
    model: z.string().trim().min(1),
  })
  .superRefine((data, ctx) => {
    const allowedIds = storyboardModelCatalog[data.providerId].map((entry) => entry.id);
    if (!allowedIds.some((id) => id === data.model)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Model must be a catalog option for ${data.providerId}.`,
      });
    }
  });

export const settingsUpdateProviderBaseUrlRequestPayloadSchema = z.object({
  providerId: z.literal('ollama'),
  baseUrl: z.string().trim().min(1),
});

export const settingsUpdateProviderCommandRequestPayloadSchema = z.object({
  providerId: z.enum(['claude-code', 'codex']),
  command: z.string().trim().min(1),
});

export const settingsUpdateTaskAiConfigRequestPayloadSchema = z
  .object({
    taskName: aiTaskNameSchema,
    providerId: providerIdSchema.nullable(),
    model: z.string().trim().min(1).nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.providerId === null) {
      if (data.model !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'model must be null when providerId is null.',
        });
      }
      return;
    }

    if (data.model === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'model is required when providerId is set.',
      });
      return;
    }

    const allowedIds = storyboardModelCatalog[data.providerId].map((entry) => entry.id);
    if (!allowedIds.some((id) => id === data.model)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Model must be a catalog option for ${data.providerId}.`,
      });
    }
  });

export const settingsMutationOkResponsePayloadSchema = z.object({});
