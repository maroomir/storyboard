import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { SimReport } from '@/commands/sim/simReport';

export class SimApplyCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'sim apply',
    group: '측정',
    usage: 'sim apply --out <path> --point <label> [--dry-run] [--force] [--profiles <path>]',
    summary: '고른 지점을 모델 프로필에 적습니다',
    flags: ['out', 'point', 'dry-run', 'force', 'profiles'],
    examples: ['storyboard sim apply --out runs.jsonl --point grid:0120 --dry-run'],
    needsWorkspace: false,
  };

  public async execute(context: CommandContext): Promise<CommandOutcome> {
    return await new SimReport(context).apply();
  }
}
