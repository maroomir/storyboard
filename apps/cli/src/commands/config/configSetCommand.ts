import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import { type CommandSpec, providerKeys, type ProviderKey } from '@/commands/catalog';
import { ConfigEditor } from '@/commands/config/configEditor';
import { HiddenProviderSwitch } from '@/commands/hiddenProviderSwitch';
import {
  describeOutOfRange,
  describeUnknownKey,
  findProviderModelProblem,
  parseSettingValue,
  taskKeyPattern,
} from '@/commands/config/configKeys';
import { availableProviderIds, isAvailableProviderId } from '@/adapters/availableProviders';
import { flagString } from '@/cliArguments';
import { failure } from '@/commands/outcomes';
import type { CliContainer } from '@/container';
import {
  decimalSettingStep,
  extractErrorMessage,
  isOnDecimalStep,
  storyboardSettingCatalog,
  type StoryboardSettingDefinition,
} from '@storyboard/story-model';

export class ConfigSetCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'config set',
    group: '시작하기',
    usage: 'config set <key> <value> [--model <name>] [--global]',
    summary:
      '이 작품의 .storyboard/config.json 값을 바꿉니다 (--global 이면 ~/.storyboard/config.json)',
    flags: ['model', 'global'],
    examples: [
      'storyboard config set ai.provider.default claude --model claude-sonnet-5',
      'storyboard config set tasks.noteExtraction.provider claude --model claude-opus-5-5',
      'storyboard config set revise.loop.maxIterations 3',
    ],
    needsWorkspace: false,
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const editor: ConfigEditor = new ConfigEditor(container);
    const key: string | undefined = flagString(args.flags, 'key') ?? args.positionals[0];
    const raw: string | undefined = flagString(args.flags, 'value') ?? args.positionals[1];
    const modelFlag: string | undefined = flagString(args.flags, 'model');

    if (key === undefined || raw === undefined) {
      return failure('사용법: storyboard config set <key> <value>');
    }

    if (key === 'ai.provider.default') {
      return this.setDefaultProvider(container, editor, raw, modelFlag);
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

    return hiddenProviderOutcome ?? this.setProviderOrSetting(container, editor, key, raw);
  }

  private async setDefaultProvider(
    container: CliContainer,
    editor: ConfigEditor,
    raw: string,
    modelFlag: string | undefined,
  ): Promise<CommandOutcome> {
    const key: string = 'ai.provider.default';

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

    await container.configBridge.setDefaultProvider(raw);
    if (modelFlag === undefined) {
      return editor.describeSaved(key, raw);
    }

    await container.configBridge.setProviderModel(raw, modelFlag);
    return editor.describeSaved(key, raw, [`providers.${raw}.model = ${modelFlag}`]);
  }

  private async setProviderOrSetting(
    container: CliContainer,
    editor: ConfigEditor,
    key: string,
    raw: string,
  ): Promise<CommandOutcome> {
    const providerMatch: RegExpExecArray | null = new RegExp(
      `^providers\\.([a-z-]+)\\.(${providerKeys.join('|')})$`,
    ).exec(key);

    if (!providerMatch) {
      return this.setSetting(container, editor, key, raw);
    }

    const providerId: string = providerMatch[1] ?? '';
    const field: ProviderKey = providerMatch[2] as ProviderKey;

    if (!isAvailableProviderId(providerId)) {
      return failure(`알 수 없는 프로바이더: ${providerId}`);
    }

    return editor.setProviderField(providerId, field, raw);
  }

  private async setSetting(
    container: CliContainer,
    editor: ConfigEditor,
    key: string,
    raw: string,
  ): Promise<CommandOutcome> {
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

    const valueProblem: string | undefined = describeSettingValueProblem(definition, raw, value);

    if (valueProblem !== undefined) {
      return failure(valueProblem);
    }

    try {
      await container.configBridge.setSettingValue(key, value);
    } catch (error) {
      return failure(extractErrorMessage(error));
    }

    return editor.describeSaved(key, value);
  }
}

function describeSettingValueProblem(
  definition: StoryboardSettingDefinition,
  raw: string,
  value: string | number | boolean,
): string | undefined {
  if (definition.kind === 'decimal' && !isOnDecimalStep(value as number)) {
    return `${definition.label}(${definition.key}) 값은 소수 둘째 자리(${decimalSettingStep} 단위)까지만 받습니다: ${raw}`;
  }

  return describeOutOfRange(definition, value);
}
