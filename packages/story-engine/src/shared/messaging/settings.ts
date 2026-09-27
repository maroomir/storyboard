import { z } from 'zod';

import {
  findStoryboardSetting,
  isValidStoryboardSettingValue,
  storyboardModelCatalog,
} from '@storyboard/story-ai/contracts';
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
const taskCatalogEntrySchema = z.object({
  name: aiTaskNameSchema,
  label: z.string().trim().min(1),
});

export const configValueOriginSchema = z.enum(['default', 'user', 'workspace']);

const settingValueSchema = z.union([z.boolean(), z.number(), z.string()]);

const settingDefinitionPayloadSchema = z.object({
  key: z.string().trim().min(1),
  label: z.string().trim().min(1),
  description: z.string(),
  kind: z.enum(['boolean', 'integer', 'string']),
  defaultValue: settingValueSchema,
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  group: z.string().trim().min(1),
});

// `origins` says which config layer each value came from and `configFiles` where those layers
// live, so the panel can tell the author "saved to this work" versus "saved for every work".
export const settingsReadResponsePayloadSchema = z.object({
  defaultProvider: providerIdSchema,
  isDefaultProviderConfigured: z.boolean(),
  providers: z.array(aiProviderStatusSchema),
  providerConfigs: providerConfigsPayloadSchema,
  taskAssignments: taskAssignmentsPayloadSchema,
  modelCatalog: storyboardModelCatalogPayloadSchema,
  taskCatalog: z.array(taskCatalogEntrySchema).min(1),
  origins: z.record(z.string(), configValueOriginSchema),
  configFiles: z.object({
    user: z.string().trim().min(1),
    workspace: z.string().trim().min(1).optional(),
  }),
  settingCatalog: z.array(settingDefinitionPayloadSchema),
  settingValues: z.record(z.string(), settingValueSchema),
});

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

export const settingsUpdateSettingValueRequestPayloadSchema = z
  .object({
    key: z.string().trim().min(1),
    value: settingValueSchema,
  })
  .superRefine((data, ctx) => {
    const definition = findStoryboardSetting(data.key);

    if (!definition) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Unknown setting: ${data.key}.` });
      return;
    }

    if (!isValidStoryboardSettingValue(definition, data.value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Value is not valid for ${data.key} (${definition.kind}).`,
      });
    }
  });

// Where the write landed, so the panel can confirm it instead of leaving the author guessing.
export const settingsMutationOkResponsePayloadSchema = z.object({
  origin: configValueOriginSchema.optional(),
  file: z.string().optional(),
});
