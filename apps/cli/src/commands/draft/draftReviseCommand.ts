import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { failure, success } from '@/commands/outcomes';
import { sceneStemFrom } from '@/commands/sceneArguments';
import { describeReviseOutcome, type ReviseDraftWorkflowResult } from '@storyboard/story-engine';

export class DraftReviseCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'draft revise',
    writesWorkspace: true,
    rewritesDraft: true,
    group: '초안',
    usage: 'draft revise <stem>',
    summary: '기존 초안을 검수하고 재작성합니다',
    flags: ['revise-iterations'],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const stem: string | undefined = sceneStemFrom(args);
    if (stem === undefined) {
      return failure('씬 stem을 지정해 주세요.');
    }

    const revision: ReviseDraftWorkflowResult | undefined = await container.drafts.reviseScene(
      container.workspaceRoot,
      stem,
    );
    if (revision === undefined) {
      return failure('초안이 없어 검수를 건너뛰었습니다.');
    }

    return revision.failure
      ? failure(describeReviseOutcome(revision).warning ?? revision.failure.message, revision)
      : success('검수와 재작성을 마쳤습니다.', revision);
  }
}
