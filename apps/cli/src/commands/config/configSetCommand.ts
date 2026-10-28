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
}
