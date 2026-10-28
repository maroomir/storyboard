import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { flagString } from '@/cliArguments';
import { failure, success } from '@/commands/outcomes';
import type { ExportManuscriptResult, LoadExportSourceResult } from '@storyboard/story-engine';
import { NodeUri, type ManuscriptExportFormat } from '@storyboard/story-model';
import { resolve } from 'node:path';

export class ManuscriptExportCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'manuscript export',
    group: '원고',
    usage: 'manuscript export [--out <path>]',
    summary: '조립 원고를 stdout 또는 --out 파일로 냅니다',
    flags: ['out'],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const source: LoadExportSourceResult = await container.manuscript.loadExportSource(
      container.workspaceRoot,
    );

    if (!source.ok) {
      return failure(`내보낼 원고가 없습니다 (${source.kind}).`, source);
    }

    const target: string | undefined = flagString(args.flags, 'out');

    if (target === undefined) {
      process.stdout.write(source.markdown);
      return success('', { projectName: source.projectName });
    }

    const format: ManuscriptExportFormat = target.toLowerCase().endsWith('.txt') ? 'txt' : 'md';
    const exported: ExportManuscriptResult = await container.manuscript.writeExport(
      NodeUri.file(resolve(target)),
      source.markdown,
      format,
    );

    if (!exported.ok) {
      return failure(`내보내지 못했습니다: ${exported.message}`);
    }

    return success(`${target} 로 내보냈습니다.`, { path: target, format });
  }
}
