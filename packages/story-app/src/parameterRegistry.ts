import {
  generationParameterCatalog,
  promptResourceKeys,
  promptResources,
  storyboardSettingCatalog,
  type ConfigBridge,
} from '@storyboard/story-ai';
import { generationParameterDefault } from '@storyboard/story-engine';
import type { StoryUri } from '@storyboard/story-format';

import type { ResourceOverrideReport } from './resourceOverrides';

// Every value an author can move, in one list with where its current value comes from: the
// settings (`config.json`), the generation knobs (model profile over pipeline default) and each
// prompt's sampling config (the author's prompt file over the bundled front-matter).
export type ParameterKind = 'setting' | 'generation' | 'prompt';

// Where the value in force was set. `user` is the home layer, `workspace` the work's own, `model`
// a measured model profile, `default` the bundled value.
export type ParameterOrigin = 'workspace' | 'user' | 'model' | 'default';

export interface ParameterEntry {
  readonly kind: ParameterKind;
  readonly id: string;
  readonly label: string;
  readonly value: boolean | number | string;
  readonly defaultValue: boolean | number | string;
  readonly origin: ParameterOrigin;
}

export interface ParameterReport {
  readonly parameters: readonly ParameterEntry[];
  readonly resources: ResourceOverrideReport;
}

export interface DescribeParametersInput {
  readonly configBridge: ConfigBridge;
  readonly resources: ResourceOverrideReport;
  // The resource roots in precedence order; the first is the home layer, any later one the workspace.
  readonly roots: readonly StoryUri[];
}

export function describeParameters(input: DescribeParametersInput): ParameterReport {
  return {
    parameters: [
      ...settingEntries(input.configBridge),
      ...generationEntries(input.configBridge),
      ...promptEntries(input.resources, input.roots),
    ],
    resources: input.resources,
  };
}

function settingEntries(configBridge: ConfigBridge): ParameterEntry[] {
  return storyboardSettingCatalog.map((definition) => {
    const modelDefault = configBridge.getModelProfileDefault(definition.key);
    const origin = configBridge.getValueOrigin(definition.key);

    return {
      kind: 'setting',
      id: definition.key,
      label: definition.label,
      value: configBridge.getSettingValue(definition.key),
      defaultValue: modelDefault ?? definition.defaultValue,
      origin: origin === 'default' && modelDefault !== undefined ? 'model' : origin,
    };
  });
}

function generationEntries(configBridge: ConfigBridge): ParameterEntry[] {
  const profileKnobs = configBridge.getSceneGenerationTuning();

  return generationParameterCatalog.map((definition) => {
    const defaultValue = generationParameterDefault(definition.id);
    const measured = profileKnobs[definition.id];

    return {
      kind: 'generation',
      id: definition.id,
      label: definition.label,
      value: measured ?? defaultValue,
      defaultValue,
      origin: measured === undefined ? 'default' : 'model',
    };
  });
}

function promptEntries(
  resources: ResourceOverrideReport,
  roots: readonly StoryUri[],
): ParameterEntry[] {
  return promptResourceKeys().flatMap((key) => {
    const config = promptResources.config(key);
    const bundled = promptResources.bundledConfig(key);
    const origin = promptOrigin(key, resources, roots);

    return [
      {
        kind: 'prompt' as const,
        id: `prompt.${key}.temperature`,
        label: `${key} 온도`,
        value: config.temperature,
        defaultValue: bundled.temperature,
        origin: config.temperature === bundled.temperature ? 'default' : origin,
      },
      {
        kind: 'prompt' as const,
        id: `prompt.${key}.maxTokens`,
        label: `${key} 출력 상한`,
        value: config.maxTokens,
        defaultValue: bundled.maxTokens,
        origin: config.maxTokens === bundled.maxTokens ? 'default' : origin,
      },
    ];
  });
}

// The last applied file for a prompt is the one in force; its root says which layer that is.
function promptOrigin(
  key: string,
  resources: ResourceOverrideReport,
  roots: readonly StoryUri[],
): ParameterOrigin {
  const applied = [...resources.applied]
    .reverse()
    .find((entry) => entry.kind === 'prompt' && entry.key === key);

  if (applied === undefined) {
    return 'default';
  }

  const index = roots.findIndex((root) => root.fsPath === applied.root.fsPath);

  return index <= 0 ? 'user' : 'workspace';
}
