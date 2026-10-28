import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { SimRunner } from '@/commands/sim/simRunner';

export class SimRunCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'sim run',
    group: '측정',
    usage: 'sim run --track <path> [--genre <name>]',
    summary: '트랙 한 벌을 한 지점으로 돌리고 품질·비용을 잽니다',
    flags: [
      'track',
      'config',
      'genre',
      'overlay',
      'repeats',
      'judge',
      'judge-model',
      'out',
      'provider',
      'model',
      'prompt-variant',
      'yes',
    ],
    examples: [
      'storyboard sim run --track ~/storyboard-workspace --genre thriller',
      'storyboard sim run --track ~/storyboard-workspace --overlay point.json --yes',
    ],
    needsWorkspace: false,
  };

  public async execute(context: CommandContext): Promise<CommandOutcome> {
    return await new SimRunner(context).run();
  }
}
