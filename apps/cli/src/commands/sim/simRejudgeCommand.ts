import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { SimRunner } from '@/commands/sim/simRunner';

export class SimRejudgeCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'sim rejudge',
    group: '측정',
    usage:
      'sim rejudge --track <path> --genre <name> --judge <provider> --judge-model <name> [--point <label>] [--source <engine>] [--yes]',
    summary: '저장된 원고를 다른 심판으로 다시 채점합니다 (생성은 하지 않습니다)',
    flags: ['track', 'config', 'genre', 'point', 'source', 'judge', 'judge-model', 'out', 'yes'],
    examples: [
      'storyboard sim rejudge --track . --genre thriller --judge claude --judge-model claude-sonnet-5 --yes',
    ],
    needsWorkspace: false,
  };

  public async execute(context: CommandContext): Promise<CommandOutcome> {
    return await new SimRunner(context).rejudge();
  }
}
