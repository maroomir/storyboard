import { z } from 'zod';

import {
  aiProviderIds,
  aiTaskNames,
  promptVariantIds,
  storyboardSettingCatalog,
  type StoryboardSettingDefinition,
} from '@storyboard/story-ai';

import { ConfigFileError } from '#config/configFileError';

// A key the file spells that nothing reads. It is kept (a newer app may know it) but reported, so a
// typo does not silently become "the default".
export interface ConfigKeyWarning {
  readonly file: string;
  readonly key: string;
  readonly message: string;
}

function settingSchema(definition: StoryboardSettingDefinition): z.ZodType {
  switch (definition.kind) {
    case 'boolean':
      return z.boolean();
    case 'integer': {
      let schema = z.number().int();
      if (definition.minimum !== undefined) {
        schema = schema.min(definition.minimum);
      }
      if (definition.maximum !== undefined) {
        schema = schema.max(definition.maximum);
      }
      return schema;
    }
    case 'string':
      return z.string().trim().min(1);
  }
}

const providerIdSchema = z.enum(aiProviderIds);
const nonEmptyString = z.string().trim().min(1);

// Every dotted key a config file may carry, with the shape its value must have. The switches come
// from the setting catalog; the provider, model and task routing keys are the ones ConfigBridge
// reads by name.
function buildKnownKeySchemas(): ReadonlyMap<string, z.ZodType> {
  const schemas = new Map<string, z.ZodType>();

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

  for (const taskName of aiTaskNames) {
    schemas.set(`tasks.${taskName}.provider`, providerIdSchema);
    schemas.set(`tasks.${taskName}.model`, nonEmptyString);
  }

  return schemas;
}

const knownKeySchemas = buildKnownKeySchemas();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Walks one file's settings. A key may be spelled flat ("generation.beats.minimum") or nested, so the walk
// joins path segments and checks the joined key at every level: a known key is validated, an
// object under an unknown key is descended into, anything else is an unknown key.
export function validateConfigSettings(
  file: string,
  settings: Record<string, unknown>,
): readonly ConfigKeyWarning[] {
  const warnings: ConfigKeyWarning[] = [];

  const visit = (value: unknown, key: string): void => {
    const schema = knownKeySchemas.get(key);

    if (schema) {
      const parsed = schema.safeParse(value);

      if (!parsed.success) {
        throw new ConfigFileError(
          'invalid-value',
          file,
          `설정 값이 올바르지 않습니다: ${key} (${file})`,
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
