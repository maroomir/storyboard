import { availableProviderIds, isAvailableProviderId } from '@/adapters/availableProviders';
import { flagString } from '@/cliArguments';
import { providerKeys, type ProviderKey } from '@/commands/catalog';
import { setHiddenProviderKey } from '@/commands/hiddenProvider';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import { failure } from '@/commands/outcomes';
import type { CliContainer } from '@/container';
import type { ConfigBridge, ProviderModelConfig, TaskAiConfigOverride } from '@storyboard/story-ai';
import {
  aiTaskNames,
  decimalSettingStep,
  extractErrorMessage,
  isModelInCatalogForProvider,
  isOnDecimalStep,
  storyboardModelCatalog,
  storyboardSettingCatalog,
  type AiProviderId,
  type AiTaskName,
  type ConfigValueOrigin,
  type StoryboardSettingDefinition,
  type StoryboardSettingKind,
} from '@storyboard/story-model';
import { success } from './outcomes';

export function describeOrigin(configBridge: ConfigBridge, key: string): string {
  switch (configBridge.getValueOrigin(key)) {
    case 'workspace':
      return '이 작품';
    case 'user':
      return '공통';
    default:
      return configBridge.getModelProfileDefault(key) === undefined ? '기본값' : '모델 실측';
  }
}

export async function runConfigShow({ container }: CommandContext): Promise<CommandOutcome> {
  const { configBridge } = container;
  const rows: Array<{ key: string; value: unknown; origin: string }> = [
    {
      key: 'ai.provider.default',
      value: configBridge.isDefaultProviderConfigured() ? configBridge.getDefaultProvider() : null,
      origin: describeOrigin(configBridge, 'ai.provider.default'),
    },
  ];

  for (const providerId of availableProviderIds()) {
    const runtime: ProviderModelConfig = configBridge.getProviderConfig(providerId);
    for (const key of providerKeys) {
      const value: string | number | undefined = runtime[key];
      if (value !== undefined) {
        const settingKey: string = `providers.${providerId}.${key}`;
        rows.push({ key: settingKey, value, origin: describeOrigin(configBridge, settingKey) });
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
        rows.push({ key: settingKey, value, origin: describeOrigin(configBridge, settingKey) });
      }
    }
  }

  for (const definition of storyboardSettingCatalog) {
    rows.push({
      key: definition.key,
      value: configBridge.getSettingValue(definition.key),
      origin: describeOrigin(configBridge, definition.key),
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

export function describeSaved(
  container: CliContainer,
  key: string,
  value: unknown,
  notes: readonly string[] = [],
): CommandOutcome {
  const file: string = container.configWriteFile;
  const origin: ConfigValueOrigin = container.configBridge.getValueOrigin(key);
  const isShadowed: boolean = file === container.homePaths.configFile && origin === 'workspace';

  return success(
    [
      `${key} = ${String(value)} 저장했습니다: ${file}`,
      ...notes,
      ...(isShadowed ? [`다만 이 작품의 ${container.workspaceConfigFile} 값이 우선합니다.`] : []),
    ].join('\n'),
    { key, value, origin, file },
  );
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

export async function setProviderField(
  container: CliContainer,
  providerId: AiProviderId,
  field: ProviderKey,
  raw: string,
): Promise<CommandOutcome> {
  const { configBridge } = container;

  if (field === 'model') {
    const modelProblem: string | undefined = findProviderModelProblem(providerId, raw);
    if (modelProblem !== undefined) {
      return failure(modelProblem);
    }
    await configBridge.setProviderModel(providerId, raw);
  } else if (field === 'baseUrl') {
    if (providerId !== 'ollama') {
      return failure('baseUrl 은 ollama 에만 있습니다.');
    }
    await configBridge.setProviderBaseUrl(raw);
  } else {
    if (providerId !== 'ollama') {
      return failure('contextTokens 는 ollama 에만 있습니다.');
    }

    const tokens: number = Number(raw);
    if (!Number.isInteger(tokens) || tokens <= 0) {
      return failure(`contextTokens 는 양의 정수여야 합니다: ${raw}`);
    }

    await configBridge.setProviderContextTokens(tokens);
  }

  return describeSaved(container, `providers.${providerId}.${field}`, raw);
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

export async function setTaskRoute(
  container: CliContainer,
  taskName: string,
  field: 'provider' | 'model',
  raw: string,
  modelFlag: string | undefined,
): Promise<CommandOutcome> {
  const { configBridge } = container;
  const key: string = `tasks.${taskName}.${field}`;

  if (!isTaskName(taskName)) {
    return failure(`알 수 없는 작업: ${taskName}\n쓸 수 있는 값: ${aiTaskNames.join(', ')}`);
  }

  const current: TaskAiConfigOverride | null = configBridge.getTaskAiConfigOverride(taskName);

  if (field === 'model') {
    if (modelFlag !== undefined) {
      return failure(
        `--model 은 tasks.${taskName}.provider 와 함께 씁니다. 모델만 바꾸려면 값으로 주세요.`,
      );
    }

    const isFilledFromDefault: boolean = current === null;

    if (isFilledFromDefault && !configBridge.isDefaultProviderConfigured()) {
      return failure(
        `기본 프로바이더가 없어 ${raw} 가 어느 프로바이더의 모델인지 알 수 없습니다.\n` +
          `  storyboard config set tasks.${taskName}.provider <프로바이더> --model ${raw}`,
      );
    }

    const providerId: AiProviderId = current?.providerId ?? configBridge.getDefaultProvider();

    if (!isModelInCatalogForProvider(providerId, raw)) {
      return failure(describeModelOutsideCatalog(providerId, raw));
    }

    await configBridge.setTaskAiConfig(taskName, { providerId, model: raw });
    return describeSaved(
      container,
      key,
      raw,
      isFilledFromDefault
        ? [`프로바이더는 기본값 ${providerId} 로 함께 저장했습니다 (tasks.${taskName}.provider).`]
        : [],
    );
  }

  if (!isAvailableProviderId(raw)) {
    return failure(
      `알 수 없는 프로바이더: ${raw}\n쓸 수 있는 값: ${availableProviderIds().join(', ')}`,
    );
  }

  if (modelFlag !== undefined && !isModelInCatalogForProvider(raw, modelFlag)) {
    return failure(describeModelOutsideCatalog(raw, modelFlag));
  }

  const keptModel: string | null = current?.model ?? null;
  const isKeptModelUsable: boolean =
    keptModel !== null && isModelInCatalogForProvider(raw, keptModel);
  const model: string | null = modelFlag ?? (isKeptModelUsable ? keptModel : null);

  if (modelFlag === undefined && keptModel !== null && !isKeptModelUsable) {
    container.logger.warn(
      `tasks.${taskName}.model 을 비웠습니다: ${keptModel} 는 ${raw} 의 모델이 아닙니다. ` +
        `${raw} 에 정한 모델로 실행합니다.`,
    );
  }

  await configBridge.setTaskAiConfig(taskName, { providerId: raw, model });
  return describeSaved(
    container,
    key,
    raw,
    modelFlag === undefined ? [] : [`tasks.${taskName}.model = ${modelFlag}`],
  );
}

export async function runConfigSet({ container, args }: CommandContext): Promise<CommandOutcome> {
  const { configBridge } = container;
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
      return describeSaved(container, key, raw);
    }

    await configBridge.setProviderModel(raw, modelFlag);
    return describeSaved(container, key, raw, [`providers.${raw}.model = ${modelFlag}`]);
  }

  const taskMatch: RegExpExecArray | null = taskKeyPattern.exec(key);

  if (taskMatch) {
    return setTaskRoute(
      container,
      taskMatch[1] ?? '',
      taskMatch[2] as 'provider' | 'model',
      raw,
      modelFlag,
    );
  }

  if (modelFlag !== undefined) {
    return failure('--model 은 ai.provider.default 나 tasks.<task>.provider 와 함께만 씁니다.');
  }

  const hiddenProviderOutcome: CommandOutcome | undefined = await setHiddenProviderKey(
    container,
    key,
    raw,
  );

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

    return setProviderField(container, providerId, field, raw);
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

  return describeSaved(container, key, value);
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

export async function runConfigUnset({ container, args }: CommandContext): Promise<CommandOutcome> {
  const { configBridge } = container;
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
        : [
            `다만 ${describeOrigin(configBridge, key)} 설정의 값 ${String(value)} 가 계속 적용됩니다.`,
          ]),
    ].join('\n'),
    { key, file, origin, value: value ?? null },
  );
}
