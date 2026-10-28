import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { ConfigEditor } from '@/commands/config/configEditor';
import { findUnsettableKeyProblem, isTaskName, taskKeyPattern } from '@/commands/config/configKeys';
import { flagString } from '@/cliArguments';
import { failure, success } from '@/commands/outcomes';
import type { ConfigValueOrigin } from '@storyboard/story-model';

export class ConfigUnsetCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'config unset',
    group: '시작하기',
    usage: 'config unset <key> [--global]',
    summary:
      '이 작품의 .storyboard/config.json 에서 값을 지웁니다 (--global 이면 ~/.storyboard/config.json)',
    flags: ['global'],
    examples: [
      'storyboard config unset tasks.noteExtraction.provider --global',
      'storyboard config unset revise.loop.maxIterations',
    ],
    needsWorkspace: false,
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
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
}
