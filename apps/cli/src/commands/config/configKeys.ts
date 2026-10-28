import { isAvailableProviderId } from '@/adapters/availableProviders';
import { providerKeys } from '@/commands/catalog';
import {
  aiTaskNames,
  isModelInCatalogForProvider,
  storyboardModelCatalog,
  storyboardSettingCatalog,
  type AiProviderId,
  type AiTaskName,
  type StoryboardSettingDefinition,
  type StoryboardSettingKind,
} from '@storyboard/story-model';

export function describeOutOfRange(
  definition: StoryboardSettingDefinition,
  value: boolean | number | string,
): string | undefined {
  const { minimum, maximum } = definition;
  const isBelow: boolean = typeof value === 'number' && minimum !== undefined && value < minimum;
  const isAbove: boolean = typeof value === 'number' && maximum !== undefined && value > maximum;

  if (!isBelow && !isAbove) {
    return undefined;
  }

  const range: string = [
    ...(minimum === undefined ? [] : [`${minimum} 이상`]),
    ...(maximum === undefined ? [] : [`${maximum} 이하`]),
  ].join(' ');
  const ending: '이어야' | '여야' = maximum === undefined ? '이어야' : '여야';
  return `${definition.label}(${definition.key}) 값은 ${range}${ending} 합니다: ${value}`;
}

export function parseSettingValue(
  kind: StoryboardSettingKind,
  raw: string,
): boolean | number | string | undefined {
  switch (kind) {
    case 'boolean':
      return raw === 'true' ? true : raw === 'false' ? false : undefined;
    case 'integer': {
      const parsed: number = Number.parseInt(raw, 10);
      return Number.isNaN(parsed) ? undefined : parsed;
    }
    case 'decimal': {
      const parsed: number = Number(raw);
      return raw.trim().length === 0 || !Number.isFinite(parsed) ? undefined : parsed;
    }
    case 'string':
      return raw;
  }
}

export function describeModelOutsideCatalog(providerId: AiProviderId, model: string): string {
  return (
    `${providerId} 에 없는 모델: ${model}\n` +
    `쓸 수 있는 값: ${storyboardModelCatalog[providerId].map((entry) => entry.id).join(', ')}`
  );
}

export function findProviderModelProblem(
  providerId: AiProviderId,
  model: string,
): string | undefined {
  const hasMachineSpecificModelList: boolean = providerId === 'ollama';

  return hasMachineSpecificModelList || isModelInCatalogForProvider(providerId, model)
    ? undefined
    : describeModelOutsideCatalog(providerId, model);
}

export function describeUnknownKey(key: string): string {
  return (
    `알 수 없는 설정 키: ${key}\n쓸 수 있는 키: ai.provider.default, ` +
    `providers.<id>.${providerKeys.join('|')}, tasks.<task>.provider|model, ` +
    storyboardSettingCatalog.map((entry) => entry.key).join(', ')
  );
}

export const taskKeyPattern: RegExp = /^tasks\.([^.]+)\.(provider|model)$/;

export function isTaskName(value: string): value is AiTaskName {
  return (aiTaskNames as readonly string[]).includes(value);
}

export function findUnsettableKeyProblem(key: string): string | undefined {
  const taskMatch: RegExpExecArray | null = taskKeyPattern.exec(key);

  if (taskMatch) {
    const taskName: string = taskMatch[1] ?? '';
    return isTaskName(taskName)
      ? undefined
      : `알 수 없는 작업: ${taskName}\n쓸 수 있는 값: ${aiTaskNames.join(', ')}`;
  }

  const providerMatch: RegExpExecArray | null = new RegExp(
    `^providers\\.([a-z-]+)\\.(${providerKeys.join('|')})$`,
  ).exec(key);
  const isKnownKey: boolean =
    key === 'ai.provider.default' ||
    (providerMatch !== null && isAvailableProviderId(providerMatch[1] ?? '')) ||
    storyboardSettingCatalog.some((entry) => entry.key === key);

  return isKnownKey ? undefined : describeUnknownKey(key);
}
