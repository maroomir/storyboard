import { ConfigEditor } from '@/commands/configEditor';
import { HiddenProviderSwitch } from '@/commands/hiddenProviderSwitch';
import {
  describeOutOfRange,
  describeUnknownKey,
  findProviderModelProblem,
  findUnsettableKeyProblem,
  isTaskName,
  parseSettingValue,
  taskKeyPattern,
} from '@/commands/configKeys';
import { availableProviderIds, isAvailableProviderId } from '@/adapters/availableProviders';
import { flagString } from '@/cliArguments';
import { providerKeys, type ProviderKey } from '@/commands/catalog';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import { failure } from '@/commands/outcomes';
import type { ProviderModelConfig, TaskAiConfigOverride } from '@storyboard/story-ai';
import {
  aiTaskNames,
  decimalSettingStep,
  extractErrorMessage,
  isOnDecimalStep,
  storyboardSettingCatalog,
  type ConfigValueOrigin,
  type StoryboardSettingDefinition,
} from '@storyboard/story-model';
import { success } from './outcomes';

export async function runConfigShow({ container }: CommandContext): Promise<CommandOutcome> {
  const { configBridge } = container;
  const editor: ConfigEditor = new ConfigEditor(container);
  const rows: Array<{ key: string; value: unknown; origin: string }> = [
    {
      key: 'ai.provider.default',
      value: configBridge.isDefaultProviderConfigured() ? configBridge.getDefaultProvider() : null,
      origin: editor.describeOrigin('ai.provider.default'),
    },
  ];

  for (const providerId of availableProviderIds()) {
    const runtime: ProviderModelConfig = configBridge.getProviderConfig(providerId);
    for (const key of providerKeys) {
      const value: string | number | undefined = runtime[key];
      if (value !== undefined) {
        const settingKey: string = `providers.${providerId}.${key}`;
        rows.push({ key: settingKey, value, origin: editor.describeOrigin(settingKey) });
      }
    }
  }

  for (const taskName of aiTaskNames) {
    const route: TaskAiConfigOverride | null = configBridge.getTaskAiConfigOverride(taskName);
    if (route === null) {
      continue;
    }

    const routeValues: Readonly<Record<string, string | null>> = {
      provider: route.providerId,
      model: route.model,
    };
    for (const [field, value] of Object.entries(routeValues)) {
      if (value !== null) {
        const settingKey: string = `tasks.${taskName}.${field}`;
        rows.push({ key: settingKey, value, origin: editor.describeOrigin(settingKey) });
      }
    }
  }

  for (const definition of storyboardSettingCatalog) {
    rows.push({
      key: definition.key,
      value: configBridge.getSettingValue(definition.key),
      origin: editor.describeOrigin(definition.key),
    });
  }

  const width: number = Math.max(...rows.map((row) => row.key.length));
  const lines: string[] = rows.map(
    (row) => `${row.key.padEnd(width)}  ${String(row.value ?? '(없음)').padEnd(24)}  ${row.origin}`,
  );
  const files: string[] = [
    `공통 설정: ${container.homePaths.configFile}`,
    ...(container.workspaceConfigFile ? [`이 작품 설정: ${container.workspaceConfigFile}`] : []),
  ];

  return success([...files, '', ...lines].join('\n'), { rows, files });
}

export async function runConfigSet({ container, args }: CommandContext): Promise<CommandOutcome> {
  const { configBridge } = container;
  const editor: ConfigEditor = new ConfigEditor(container);
  const key: string | undefined = flagString(args.flags, 'key') ?? args.positionals[0];
  const raw: string | undefined = flagString(args.flags, 'value') ?? args.positionals[1];
  const modelFlag: string | undefined = flagString(args.flags, 'model');

  if (key === undefined || raw === undefined) {
    return failure('사용법: storyboard config set <key> <value>');
  }

  if (key === 'ai.provider.default') {
    if (!isAvailableProviderId(raw)) {
      return failure(
        `알 수 없는 프로바이더: ${raw}\n쓸 수 있는 값: ${availableProviderIds().join(', ')}`,
      );
    }

    const modelProblem: string | undefined =
      modelFlag === undefined ? undefined : findProviderModelProblem(raw, modelFlag);
    if (modelProblem !== undefined) {
      return failure(modelProblem);
    }

    await configBridge.setDefaultProvider(raw);
    if (modelFlag === undefined) {
      return editor.describeSaved(key, raw);
    }

    await configBridge.setProviderModel(raw, modelFlag);
    return editor.describeSaved(key, raw, [`providers.${raw}.model = ${modelFlag}`]);
  }

  const taskMatch: RegExpExecArray | null = taskKeyPattern.exec(key);

  if (taskMatch) {
    return editor.setTaskRoute(
      taskMatch[1] ?? '',
      taskMatch[2] as 'provider' | 'model',
      raw,
      modelFlag,
    );
  }

  if (modelFlag !== undefined) {
    return failure('--model 은 ai.provider.default 나 tasks.<task>.provider 와 함께만 씁니다.');
  }

  const hiddenProviderOutcome: CommandOutcome | undefined = await new HiddenProviderSwitch(
    container,
  ).setKey(key, raw);

  if (hiddenProviderOutcome !== undefined) {
    return hiddenProviderOutcome;
  }

  const providerMatch: RegExpExecArray | null = new RegExp(
    `^providers\\.([a-z-]+)\\.(${providerKeys.join('|')})$`,
  ).exec(key);

  if (providerMatch) {
    const providerId: string = providerMatch[1] ?? '';
    const field: ProviderKey = providerMatch[2] as ProviderKey;

    if (!isAvailableProviderId(providerId)) {
      return failure(`알 수 없는 프로바이더: ${providerId}`);
    }

    return editor.setProviderField(providerId, field, raw);
  }

  const definition: StoryboardSettingDefinition | undefined = storyboardSettingCatalog.find(
    (entry) => entry.key === key,
  );

  if (!definition) {
    return failure(describeUnknownKey(key));
  }

  const value: string | number | boolean | undefined = parseSettingValue(definition.kind, raw);

  if (value === undefined) {
    return failure(`${key} 는 ${definition.kind} 값이어야 합니다.`);
  }

  if (definition.kind === 'decimal' && !isOnDecimalStep(value as number)) {
    return failure(
      `${definition.label}(${key}) 값은 소수 둘째 자리(${decimalSettingStep} 단위)까지만 받습니다: ${raw}`,
    );
  }

  const rangeProblem: string | undefined = describeOutOfRange(definition, value);

  if (rangeProblem !== undefined) {
    return failure(rangeProblem);
  }

  try {
    await configBridge.setSettingValue(key, value);
  } catch (error) {
    return failure(extractErrorMessage(error));
  }

  return editor.describeSaved(key, value);
}

export async function runConfigUnset({ container, args }: CommandContext): Promise<CommandOutcome> {
  const { configBridge } = container;
  const editor: ConfigEditor = new ConfigEditor(container);
  const key: string | undefined = flagString(args.flags, 'key') ?? args.positionals[0];

  if (key === undefined) {
    return failure('사용법: storyboard config unset <key>');
  }

  const keyProblem: string | undefined = findUnsettableKeyProblem(key);

  if (keyProblem !== undefined) {
    return failure(keyProblem);
  }

  const taskMatch: RegExpExecArray | null = taskKeyPattern.exec(key);
  const taskName: string | undefined = taskMatch?.[1];
  const isTaskProviderKey: boolean = taskMatch?.[2] === 'provider';

  if (isTaskProviderKey && taskName !== undefined && isTaskName(taskName)) {
    await configBridge.clearTaskAiConfig(taskName);
  } else {
    await configBridge.clearValue(key);
  }

  const file: string = container.configWriteFile;
  const origin: ConfigValueOrigin = configBridge.getValueOrigin(key);
  const value: unknown = configBridge.getConfiguredValue(key);

  return success(
    [
      `${key} 를 지웠습니다: ${file}`,
      ...(isTaskProviderKey ? [`tasks.${taskName}.model 도 함께 지웠습니다.`] : []),
      ...(origin === 'default'
        ? []
        : [`다만 ${editor.describeOrigin(key)} 설정의 값 ${String(value)} 가 계속 적용됩니다.`]),
    ].join('\n'),
    { key, file, origin, value: value ?? null },
  );
}
