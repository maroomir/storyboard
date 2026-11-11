import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { flagBoolean } from '@/cliArguments';
import { success } from '@/commands/outcomes';
import type { CliContainer } from '@/container';
import type { ReviewManuscriptResult, StoredRevisionPlan } from '@storyboard/story-engine';
import type { RevisionPlanEntry } from '@storyboard/story-model';

function describeEntry(entry: RevisionPlanEntry): string[] {
  return [
    `${entry.sceneStem}  검수 ${entry.revisionCount}회 · 남은 막힘 ${entry.remainingBlocking}`,
    ...entry.instructions.map((instruction) => `  - ${instruction}`),
  ];
}

export class ManuscriptReviewCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'manuscript review',
    writesWorkspace: true,
    group: '원고',
    usage: 'manuscript review [--show]',
    summary: '조립 원고를 검사합니다 (--show 는 캐시의 마지막 수정 계획을 읽기만, 모델을 부르지 않음)',
    flags: ['show'],
    readsOnlyWithFlags: ['show'],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    if (flagBoolean(args.flags, 'show')) {
      return await this.showRevisionPlan(container);
    }

    const manuscriptReview: ReviewManuscriptResult = await container.manuscript.review({
      workspaceRoot: container.workspaceRoot,
    });
    return {
      ok: manuscriptReview.ok,
      message: manuscriptReview.ok ? '원고 검사를 마쳤습니다.' : '검사하지 못했습니다.',
      data: manuscriptReview,
    };
  }

  private async showRevisionPlan(container: CliContainer): Promise<CommandOutcome> {
    const stored: StoredRevisionPlan | undefined = await container.manuscript.readRevisionPlan(
      container.workspaceRoot,
    );
    if (stored === undefined) {
      return success('수정 계획이 없습니다. storyboard manuscript review 로 검수하세요.', { plan: null });
    }

    return success(stored.plan.entries.flatMap(describeEntry).join('\n') || '수정할 씬이 없습니다.', stored);
  }
}
