import { z } from 'zod';

import {
  aiProviderIds,
  aiTaskNames,
  decimalSettingStep,
  getProviderTransport,
  hiddenProviderEnabledKey,
  hiddenProviderIds,
  hiddenProviderRiskAcknowledgedKey,
  isHiddenProvider,
  isOnDecimalStep,
  listAvailableProviderIds,
  requiresSubscriptionRiskNotice,
  unknownProviderMessage,
  type AiProviderId,
  storyboardSettingCatalog,
  type StoryboardSettingDefinition,
} from '@storyboard/story-model';
import { promptVariantIds } from '@storyboard/story-ai';

import { ConfigFileError } from '#config/configFileError';

export interface ConfigKeyWarning {
  readonly file: string;
  readonly key: string;
  readonly message: string;
}

function settingSchema(definition: StoryboardSettingDefinition): z.ZodType {
  switch (definition.kind) {
    case 'boolean':
      return z.boolean();
    case 'integer':
      return boundedNumberSchema(definition, z.number().int());
    case 'decimal':
      return boundedNumberSchema(definition, z.number()).refine(isOnDecimalStep, {
        message: `${decimalSettingStep} 단위여야 합니다`,
      });
    case 'string':
      return z.string().trim().min(1);
  }
}

function boundedNumberSchema(
  definition: StoryboardSettingDefinition,
  base: z.ZodNumber,
): z.ZodNumber {
  let schema: z.ZodNumber = base;
  if (definition.minimum !== undefined) {
    schema = schema.min(definition.minimum);
  }
  if (definition.maximum !== undefined) {
    schema = schema.max(definition.maximum);
  }
  return schema;
}

const providerIdSchema: z.ZodType<AiProviderId> = z.enum(aiProviderIds);
const nonEmptyString: z.ZodString = z.string().trim().min(1);

function buildKnownKeySchemas(): ReadonlyMap<string, z.ZodType> {
  const schemas: Map<
    string,
    z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>
  > = new Map<string, z.ZodType>();

  for (const definition of storyboardSettingCatalog) {
    schemas.set(definition.key, settingSchema(definition));
  }

  schemas.set('ai.provider.default', providerIdSchema);
  schemas.set('ai.prompt.variant', z.enum(promptVariantIds));
  schemas.set('providers.ollama.baseUrl', nonEmptyString);
  schemas.set('providers.ollama.contextTokens', z.number().int().positive());
  schemas.set('providers.ollama.think', z.boolean());

  for (const providerId of aiProviderIds) {
    schemas.set(`providers.${providerId}.model`, nonEmptyString);
  }

  for (const providerId of hiddenProviderIds) {
    schemas.set(hiddenProviderEnabledKey(providerId), z.boolean());

    if (requiresSubscriptionRiskNotice(providerId)) {
      schemas.set(hiddenProviderRiskAcknowledgedKey(providerId), z.boolean());
    }

    if (getProviderTransport(providerId) === 'cli') {
      schemas.set(`providers.${providerId}.command`, nonEmptyString);
      schemas.set(`providers.${providerId}.timeoutMs`, z.number().int().positive());
    }
  }

  for (const taskName of aiTaskNames) {
    schemas.set(`tasks.${taskName}.provider`, providerIdSchema);
    schemas.set(`tasks.${taskName}.model`, nonEmptyString);
  }

  return schemas;
}

const knownKeySchemas: ReadonlyMap<string, z.ZodType> = buildKnownKeySchemas();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeUnknownProvider(
  value: unknown,
  enabledHiddenProviderIds: readonly AiProviderId[],
): string[] {
  return [
    unknownProviderMessage(String(value)),
    `쓸 수 있는 값: ${listAvailableProviderIds(enabledHiddenProviderIds).join(', ')}`,
    '파일에서 고치거나 설정에서 프로바이더를 다시 고르세요.',
  ];
}

export function validateConfigSettings(
  file: string,
  settings: Record<string, unknown>,
  enabledHiddenProviderIds: readonly AiProviderId[] = [],
): readonly ConfigKeyWarning[] {
  const warnings: ConfigKeyWarning[] = [];

  const isDisabledHiddenProvider = (schema: z.ZodType, value: unknown): boolean =>
    schema === providerIdSchema &&
    isHiddenProvider(value as AiProviderId) &&
    !enabledHiddenProviderIds.includes(value as AiProviderId);

  const visit = (value: unknown, key: string): void => {
    const schema:
      | z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>
      | undefined = knownKeySchemas.get(key);

    if (schema) {
      const parsed: z.ZodSafeParseResult<unknown> = schema.safeParse(value);

      if (!parsed.success || isDisabledHiddenProvider(schema, value)) {
        throw new ConfigFileError(
          'invalid-value',
          file,
          [
            `설정 값이 올바르지 않습니다: ${key} (${file})`,
            ...(schema === providerIdSchema
              ? describeUnknownProvider(value, enabledHiddenProviderIds)
              : []),
          ].join('\n'),
          parsed.error,
        );
      }

      return;
    }

    if (isPlainObject(value)) {
      for (const [childKey, childValue] of Object.entries(value)) {
        visit(childValue, `${key}.${childKey}`);
      }

      return;
    }

    warnings.push({
      file,
      key,
      message: `알 수 없는 설정 키입니다: ${key} (${file})`,
    });
  };

  for (const [key, value] of Object.entries(settings)) {
    visit(value, key);
  }

  return warnings;
}
