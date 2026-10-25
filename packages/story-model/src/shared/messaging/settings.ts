import { z } from 'zod';

import {
  findStoryboardSetting,
  isValidStoryboardSettingValue,
  type StoryboardSettingDefinition,
} from '#model/contracts/settingCatalog';
import { storyboardModelCatalog, type ProviderModelOption } from '#model/contracts/providerCatalog';
import { aiProviderStatusSchema } from './ai';
import { aiTaskNameSchema, providerIdSchema, type ProviderId } from './atoms';
import type { AiProviderId, AiTaskCatalogEntry, AiTaskName } from '#model/contracts/ai';
import type { StoryboardSettingKind } from '#model/contracts/settingCatalog';
import type { AiProviderStatus } from '#model/contracts/aiTypes';

const providerModelOptionSchema: z.ZodType<ProviderModelOption> = z.object({
  id: z.string().trim().min(1),
  displayName: z.string().trim().min(1),
});

type StoryboardModelCatalogPayload = Record<ProviderId, ProviderModelOption[]>;

const storyboardModelCatalogPayloadSchema: z.ZodType<StoryboardModelCatalogPayload> = z.record(
  providerIdSchema,
  z.array(providerModelOptionSchema).min(1),
);

export interface ProviderRuntimeConfig {
  readonly model: string;
  readonly baseUrl?: string;
}

export interface SettingsConfigFiles {
  readonly user: string;
  readonly workspace?: string;
}

const providerRuntimeConfigSchema: z.ZodType<ProviderRuntimeConfig> = z.object({
  model: z.string().trim().min(1),
  baseUrl: z.string().trim().min(1).optional(),
});

type ProviderConfigsPayload = Record<ProviderId, ProviderRuntimeConfig>;

const providerConfigsPayloadSchema: z.ZodType<ProviderConfigsPayload> = z.record(
  providerIdSchema,
  providerRuntimeConfigSchema,
);

interface TaskAssignmentRead {
  providerId: AiProviderId | null;
  model: null | string;
}

const taskAssignmentReadSchema: z.ZodType<TaskAssignmentRead> = z
  .object({
    providerId: providerIdSchema.nullable(),
    model: z.string().nullable(),
  })
  .superRefine((assignment, refinement) => {
    if (assignment.providerId === null && assignment.model !== null) {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'taskAssignments: model must be null when providerId is null.',
      });
    }
  });

type TaskAssignmentsPayload = Record<AiTaskName, TaskAssignmentRead>;

const taskAssignmentsPayloadSchema: z.ZodType<TaskAssignmentsPayload> = z.record(
  aiTaskNameSchema,
  taskAssignmentReadSchema,
);

const taskCatalogEntrySchema: z.ZodType<AiTaskCatalogEntry> = z.object({
  name: aiTaskNameSchema,
  label: z.string().trim().min(1),
});

export type ConfigValueOrigin = 'default' | 'user' | 'workspace';

export const configValueOriginSchema: z.ZodType<ConfigValueOrigin> = z.enum([
  'default',
  'user',
  'workspace',
]);

const settingValueSchema: z.ZodType<string | number | boolean> = z.union([
  z.boolean(),
  z.number(),
  z.string(),
]);

interface SettingDefinitionPayload {
  key: string;
  label: string;
  description: string;
  kind: StoryboardSettingKind;
  defaultValue: string | number | false | true;
  group: string;
  minimum?: number;
  maximum?: number;
}

const settingDefinitionPayloadSchema: z.ZodType<SettingDefinitionPayload> = z.object({
  key: z.string().trim().min(1),
  label: z.string().trim().min(1),
  description: z.string(),
  kind: z.enum(['boolean', 'integer', 'decimal', 'string']),
  defaultValue: settingValueSchema,
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  group: z.string().trim().min(1),
});

export interface SettingsReadResponsePayload {
  defaultProvider: ProviderId;
  isDefaultProviderConfigured: boolean;
  providers: AiProviderStatus[];
  providerConfigs: ProviderConfigsPayload;
  taskAssignments: TaskAssignmentsPayload;
  modelCatalog: StoryboardModelCatalogPayload;
  taskCatalog: AiTaskCatalogEntry[];
  origins: Record<string, ConfigValueOrigin>;
  configFiles: SettingsConfigFiles;
  settingCatalog: SettingDefinitionPayload[];
  settingValues: Record<string, string | number | false | true>;
}

export const settingsReadResponsePayloadSchema: z.ZodType<SettingsReadResponsePayload> = z.object({
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

export interface SettingsReadRequestPayload {
  [key: string]: never;
}

export const settingsReadRequestPayloadSchema: z.ZodType<SettingsReadRequestPayload> = z.object({});

export interface SettingsUpdateDefaultProviderRequestPayload {
  providerId: ProviderId;
}

export const settingsUpdateDefaultProviderRequestPayloadSchema: z.ZodType<SettingsUpdateDefaultProviderRequestPayload> =
  z.object({
    providerId: providerIdSchema,
  });

export interface SettingsUpdateProviderModelRequestPayload {
  providerId: ProviderId;
  model: string;
}

export const settingsUpdateProviderModelRequestPayloadSchema: z.ZodType<SettingsUpdateProviderModelRequestPayload> =
  z
    .object({
      providerId: providerIdSchema,
      model: z.string().trim().min(1),
    })
    .superRefine((request, refinement) => {
      const allowedIds: string[] = storyboardModelCatalog[request.providerId].map(
        (entry) => entry.id,
      );
      if (!allowedIds.some((id) => id === request.model)) {
        refinement.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Model must be a catalog option for ${request.providerId}.`,
        });
      }
    });

export interface SettingsUpdateProviderBaseUrlRequestPayload {
  providerId: 'ollama';
  baseUrl: string;
}

export const settingsUpdateProviderBaseUrlRequestPayloadSchema: z.ZodType<SettingsUpdateProviderBaseUrlRequestPayload> =
  z.object({
    providerId: z.literal('ollama'),
    baseUrl: z.string().trim().min(1),
  });

export interface SettingsUpdateTaskAiConfigRequestPayload {
  taskName: AiTaskName;
  providerId: AiProviderId | null;
  model: null | string;
}

export const settingsUpdateTaskAiConfigRequestPayloadSchema: z.ZodType<SettingsUpdateTaskAiConfigRequestPayload> =
  z
    .object({
      taskName: aiTaskNameSchema,
      providerId: providerIdSchema.nullable(),
      model: z.string().trim().min(1).nullable(),
    })
    .superRefine((request, refinement) => {
      if (request.providerId === null) {
        if (request.model !== null) {
          refinement.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'model must be null when providerId is null.',
          });
        }
        return;
      }

      if (request.model === null) {
        refinement.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'model is required when providerId is set.',
        });
        return;
      }

      const allowedIds: string[] = storyboardModelCatalog[request.providerId].map(
        (entry) => entry.id,
      );
      if (!allowedIds.some((id) => id === request.model)) {
        refinement.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Model must be a catalog option for ${request.providerId}.`,
        });
      }
    });

export interface SettingsUpdateSettingValueRequestPayload {
  key: string;
  value: string | number | false | true;
}

export const settingsUpdateSettingValueRequestPayloadSchema: z.ZodType<SettingsUpdateSettingValueRequestPayload> =
  z
    .object({
      key: z.string().trim().min(1),
      value: settingValueSchema,
    })
    .superRefine((request, refinement) => {
      const definition: StoryboardSettingDefinition | undefined = findStoryboardSetting(
        request.key,
      );

      if (!definition) {
        refinement.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown setting: ${request.key}.`,
        });
        return;
      }

      if (!isValidStoryboardSettingValue(definition, request.value)) {
        refinement.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Value is not valid for ${request.key} (${definition.kind}).`,
        });
      }
    });

export interface SettingsMutationOkResponsePayload {
  origin?: ConfigValueOrigin;
  file?: string;
}

export const settingsMutationOkResponsePayloadSchema: z.ZodType<SettingsMutationOkResponsePayload> =
  z.object({
    origin: configValueOriginSchema.optional(),
    file: z.string().optional(),
  });
