import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import { type CommandSpec, noteSources, defaultNoteSource } from '@/commands/catalog';
import type { CliContainer } from '@/container';
import { askSecret, readStdin } from '@/commands/prompt';
import { failure, success } from '@/commands/outcomes';

export class NotesConnectCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'notes connect',
    group: '노트',
    usage: `notes connect [${noteSources.join('|')}]`,
    summary: 'Notion 통합 토큰을 secrets.json 에 저장합니다 (표준 입력도 받습니다, 비우면 삭제)',
    examples: ['storyboard notes connect notion'],
    needsWorkspace: false,
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const source: string = args.positionals[0] ?? defaultNoteSource;

    if (!noteSources.some((candidate) => candidate === source)) {
      return failure(
        `연결할 수 있는 노트 출처가 아닙니다: ${source}\n쓸 수 있는 값: ${noteSources.join(', ')}`,
      );
    }

    const token: string = (
      this.canAsk(container)
        ? await askSecret(
            'Notion 통합 토큰을 붙여 넣고 Enter (입력은 화면에 보이지 않습니다. 비워 두면 삭제): ',
          )
        : await readStdin()
    ).trim();

    await container.notes.connectNotion(token);

    return token.length === 0
      ? success('Notion 토큰을 지웠습니다.')
      : success(
          [
            `Notion 토큰을 저장했습니다: ${container.homePaths.secretsFile}`,
            '읽을 페이지마다 Notion 에서 「연결」에 이 통합을 추가해야 합니다.',
          ].join('\n'),
        );
  }

  private canAsk(container: CliContainer): boolean {
    return container.canPrompt && process.stdin.isTTY === true;
  }
}
