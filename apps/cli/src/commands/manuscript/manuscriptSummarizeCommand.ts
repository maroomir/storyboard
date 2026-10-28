import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import type { SummarizeChaptersResult } from '@storyboard/story-engine';

export class ManuscriptSummarizeCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'manuscript summarize',
    writesWorkspace: true,
    group: '원고',
    usage: 'manuscript summarize',
    summary: '장별 요약을 만듭니다',
  };

  public async execute({ container }: CommandContext): Promise<CommandOutcome> {
    const chapterSummaries: SummarizeChaptersResult = await container.manuscript.summarizeChapters({
      workspaceRoot: container.workspaceRoot,
    });
    return {
      ok: chapterSummaries.ok,
      message: chapterSummaries.ok ? '장별 요약을 만들었습니다.' : '요약하지 못했습니다.',
      data: chapterSummaries,
    };
  }
}
