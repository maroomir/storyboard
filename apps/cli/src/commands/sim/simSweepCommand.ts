import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { SimRunner } from '@/commands/sim/simRunner';

export class SimSweepCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'sim sweep',
    group: '측정',
    usage: 'sim sweep --track <path> --knobs <a,b,c,d>',
    summary: '고른 손잡이 넷으로 격자를 돌고 파레토 표를 냅니다',
    flags: [
      'track',
      'config',
      'genre',
      'knobs',
      'repeats',
      'max-runs',
      'judge',
      'judge-model',
      'out',
      'provider',
      'model',
      'prompt-variant',
      'yes',
    ],
    examples: [
      'storyboard sim sweep --track ~/storyboard-workspace --knobs skeleton.lengthRatio,generation.section.retryLimit,generation.dialogue.preservedRatio,generation.padding.paragraphRatio',
    ],
    needsWorkspace: false,
  };

  public async execute(context: CommandContext): Promise<CommandOutcome> {
    return await new SimRunner(context).sweep();
  }
}
