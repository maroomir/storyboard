import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import {
  originsWithoutDefaultNote,
  parameterKindLabels,
  parameterOriginLabels,
} from '@/commands/params/parameterLabels';
import type { ParameterEntry, ParameterReport } from '@storyboard/story-app';
import { success } from '@/commands/outcomes';

export class ParamsShowCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'params show',
    group: '시작하기',
    usage: 'params show',
    summary:
      '작가가 움직일 수 있는 값 전부(설정·생성 손잡이·프롬프트 온도)와 출처, 적용된 리소스 파일을 보여 줍니다',
    examples: ['storyboard params show', 'storyboard params show --json'],
    needsWorkspace: false,
  };

  public async execute({ container }: CommandContext): Promise<CommandOutcome> {
    const report: ParameterReport = await container.describeParameters();
    const width: number = Math.max(...report.parameters.map((entry) => entry.id.length));
    const lines: string[] = [];

    for (const kind of Object.keys(parameterKindLabels) as ParameterEntry['kind'][]) {
      const entries: ParameterEntry[] = report.parameters.filter((entry) => entry.kind === kind);
      lines.push(`[${parameterKindLabels[kind]}]`);

      for (const entry of entries) {
        const shown: string = String(entry.value).padEnd(12);
        const origin: string = parameterOriginLabels[entry.origin];
        const note: string = originsWithoutDefaultNote.has(entry.origin)
          ? ''
          : `  (기본값 ${String(entry.defaultValue)})`;
        lines.push(`${entry.id.padEnd(width)}  ${shown}  ${origin}${note}`);
      }

      lines.push('');
    }

    lines.push('[적용된 리소스 파일]');
    if (report.resources.applied.length === 0) {
      lines.push('(없음)');
    }
    for (const applied of report.resources.applied) {
      lines.push(`${applied.kind.padEnd(18)}  ${applied.file.fsPath}`);
    }
    for (const problem of report.resources.problems) {
      lines.push(`! ${problem.message}`);
    }

    return success(lines.join('\n'), report);
  }
}
