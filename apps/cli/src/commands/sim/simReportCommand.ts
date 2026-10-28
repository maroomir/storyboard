import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { SimReport } from '@/commands/sim/simReport';

export class SimReportCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'sim report',
    group: '측정',
    usage: 'sim report --out <path>',
    summary: '쌓인 결과를 표로 다시 그립니다 (AI 호출 없음)',
    flags: ['out'],
    examples: ['storyboard sim report --out runs.jsonl'],
    needsWorkspace: false,
  };

  public async execute(context: CommandContext): Promise<CommandOutcome> {
    return await new SimReport(context).report();
  }
}
