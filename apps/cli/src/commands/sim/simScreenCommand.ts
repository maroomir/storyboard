import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { SimRunner } from '@/commands/sim/simRunner';

export class SimScreenCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'sim screen',
    group: '측정',
    usage: 'sim screen --track <path> [--knobs <a,b,c>]',
    summary: '손잡이를 하나씩 흔들어 영향이 큰 것을 고릅니다 (심판 없이)',
    flags: [
      'track',
      'config',
      'genre',
      'knobs',
      'repeats',
      'max-runs',
      'out',
      'provider',
      'model',
      'yes',
    ],
    examples: ['storyboard sim screen --track ~/storyboard-workspace'],
    needsWorkspace: false,
  };

  public async execute(context: CommandContext): Promise<CommandOutcome> {
    return await new SimRunner(context).screen();
  }
}
