import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import type { ReviewManuscriptResult } from '@storyboard/story-engine';

export class ManuscriptReviewCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'manuscript review',
    writesWorkspace: true,
    group: '원고',
    usage: 'manuscript review',
    summary: '조립 원고를 검사합니다',
  };

  public async execute({ container }: CommandContext): Promise<CommandOutcome> {
    const manuscriptReview: ReviewManuscriptResult = await container.manuscript.review({
      workspaceRoot: container.workspaceRoot,
    });
    return {
      ok: manuscriptReview.ok,
      message: manuscriptReview.ok ? '원고 검사를 마쳤습니다.' : '검사하지 못했습니다.',
      data: manuscriptReview,
    };
  }
}
