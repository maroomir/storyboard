import {
  acceptsMaxTokens,
  acceptsTemperature,
  generationParameterCatalog,
  storyboardSettingCatalog,
} from '@storyboard/story-model';
import {
  promptResourceKeys,
  promptResources,
  promptTuning,
  type ConfigBridge,
  type PromptConfig,
} from '@storyboard/story-ai';
import { generationParameterDefault } from '@storyboard/story-engine';
import type {
  AiProviderId,
  ConfigValueOrigin,
  GenerationKnobs,
  StoryUri,
} from '@storyboard/story-model';

import type { ResourceOverrideApplied, ResourceOverrideReport } from '#app/resourceOverrides';
import { emptyRunParameters, listRunParameterKeys, type RunParameters } from '#app/runParameters';

export type ParameterKind = 'setting' | 'generation' | 'prompt';

export type ParameterOrigin =
  | 'run'
  | 'workspace'
  | 'user'
  | 'model'
  | 'default'
  | 'provider-unsupported';

export type ParameterValueKind =
  | 'boolean'
  | 'integer'
  | 'decimal'
  | 'string'
  | 'ratio'
  | 'count'
  | 'chars'
  | 'weight'
  | 'temperature'
  | 'tokens'
  | 'effort';

export interface ParameterEntry {
  readonly kind: ParameterKind;
  readonly id: string;
  readonly label: string;
  readonly value: boolean | number | string;
  readonly defaultValue: boolean | number | string;
  readonly origin: ParameterOrigin;
  readonly valueKind: ParameterValueKind;
  readonly minimum?: number;
  readonly maximum?: number;
}

export interface ParameterReport {
  readonly parameters: readonly ParameterEntry[];
  readonly resources: ResourceOverrideReport;
}

export interface DescribeParametersInput {
  readonly configBridge: ConfigBridge;
  readonly resources: ResourceOverrideReport;
  readonly roots: readonly StoryUri[];
  readonly runParameters?: RunParameters;
}

const temperatureMinimum: number = 0;
const temperatureMaximum: number = 2;
const maxTokensMinimum: number = 1;

export function describeParameters(input: DescribeParametersInput): ParameterReport {
  const runParameterKeys: ReadonlySet<string> = new Set(
    listRunParameterKeys(input.runParameters ?? emptyRunParameters),
  );
  const entries: readonly ParameterEntry[] = [
    ...settingEntries(input.configBridge),
    ...generationEntries(input.configBridge),
    ...promptEntries(input.resources, input.roots, input.configBridge),
  ];

  return {
    parameters: entries.map((entry) =>
      runParameterKeys.has(entry.id) ? { ...entry, origin: 'run' } : entry,
    ),
    resources: input.resources,
  };
}

function settingEntries(configBridge: ConfigBridge): ParameterEntry[] {
  return storyboardSettingCatalog.map((definition) => {
    const modelDefault: number | undefined = configBridge.getModelProfileDefault(definition.key);
    const origin: ConfigValueOrigin = configBridge.getValueOrigin(definition.key);

    return {
      kind: 'setting',
      id: definition.key,
      label: definition.label,
      value: configBridge.getSettingValue(definition.key),
      defaultValue: modelDefault ?? definition.defaultValue,
      origin: origin === 'default' && modelDefault !== undefined ? 'model' : origin,
      valueKind: definition.kind,
      ...(definition.minimum === undefined ? {} : { minimum: definition.minimum }),
      ...(definition.maximum === undefined ? {} : { maximum: definition.maximum }),
    };
  });
}

function generationEntries(configBridge: ConfigBridge): ParameterEntry[] {
  const profileKnobs: GenerationKnobs = configBridge.getSceneGenerationTuning();

  return generationParameterCatalog.map((definition) => {
    const defaultValue: number = generationParameterDefault(definition.id);
    const measured: number | undefined = profileKnobs[definition.id];

    return {
      kind: 'generation',
      id: definition.id,
      label: definition.label,
      value: measured ?? defaultValue,
      defaultValue,
      origin: measured === undefined ? 'default' : 'model',
      valueKind: definition.kind,
      minimum: definition.bounds.min,
      maximum: definition.bounds.max,
    };
  });
}

interface UnsupportedSamplingKnobs {
  readonly temperature: boolean;
  readonly maxTokens: boolean;
}

function unsupportedSamplingKnobs(configBridge: ConfigBridge): UnsupportedSamplingKnobs {
  const providerId: AiProviderId = configBridge.getDefaultProvider();
  const model: string = configBridge.getProviderConfig(providerId).model ?? '';

  return {
    temperature: !acceptsTemperature(providerId, model),
    maxTokens: !acceptsMaxTokens(providerId, model),
  };
}

function promptEntries(
  resources: ResourceOverrideReport,
  roots: readonly StoryUri[],
  configBridge: ConfigBridge,
): ParameterEntry[] {
  const unsupported: UnsupportedSamplingKnobs = unsupportedSamplingKnobs(configBridge);

  return promptResourceKeys().flatMap((key) => {
    const config: PromptConfig = promptTuning(key);
    const bundled: PromptConfig = promptResources.bundledConfig(key);
    const origin: ParameterOrigin = promptOrigin(key, resources, roots);

    return [
      {
        kind: 'prompt' as const,
        id: `prompt.${key}.temperature`,
        label: `${key} 온도`,
        value: config.temperature,
        defaultValue: bundled.temperature,
        origin: unsupported.temperature
          ? 'provider-unsupported'
          : config.temperature === bundled.temperature
            ? 'default'
            : origin,
        valueKind: 'temperature' as const,
        minimum: temperatureMinimum,
        maximum: temperatureMaximum,
      },
      {
        kind: 'prompt' as const,
        id: `prompt.${key}.maxTokens`,
        label: `${key} 출력 상한`,
        value: config.maxTokens,
        defaultValue: bundled.maxTokens,
        origin: unsupported.maxTokens
          ? 'provider-unsupported'
          : config.maxTokens === bundled.maxTokens
            ? 'default'
            : origin,
        valueKind: 'tokens' as const,
        minimum: maxTokensMinimum,
      },
      ...(config.reasoningEffort === undefined && bundled.reasoningEffort === undefined
        ? []
        : [
            {
              kind: 'prompt' as const,
              id: `prompt.${key}.reasoningEffort`,
              label: `${key} 사고 강도`,
              value: config.reasoningEffort ?? '',
              defaultValue: bundled.reasoningEffort ?? '',
              origin: config.reasoningEffort === bundled.reasoningEffort ? 'default' : origin,
              valueKind: 'effort' as const,
            },
          ]),
    ];
  });
}

function promptOrigin(
  key: string,
  resources: ResourceOverrideReport,
  roots: readonly StoryUri[],
): ParameterOrigin {
  const applied: ResourceOverrideApplied | undefined = [...resources.applied]
    .reverse()
    .find((entry) => entry.kind === 'prompt' && entry.key === key);

  if (applied === undefined) {
    return 'default';
  }

  const index: number = roots.findIndex((root) => root.fsPath === applied.root.fsPath);

  return index <= 0 ? 'user' : 'workspace';
}
