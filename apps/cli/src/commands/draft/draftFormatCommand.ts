import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { failure } from '@/commands/outcomes';
import { sceneStemFrom } from '@/commands/sceneArguments';
import type { ApplyDraftFormatResult } from '@storyboard/story-engine';

export class DraftFormatCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'draft format',
    writesWorkspace: true,
    rewritesDraft: true,
    group: '초안',
    usage: 'draft format <stem>',
    summary: '초안을 프로젝트 형식으로 다시 씁니다',
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const stem: string | undefined = sceneStemFrom(args);

    if (stem === undefined) {
      return failure('씬 stem 을 지정해 주세요.');
    }

    const formatting: ApplyDraftFormatResult = await container.drafts.applyFormat({
      workspaceRoot: container.workspaceRoot,
      sceneStem: stem,
    });

    return {
      ok: formatting.ok,
      message: formatting.ok
        ? '초안 형식을 다시 적용했습니다.'
        : `형식을 적용하지 못했습니다 (${formatting.kind}).`,
      data: formatting,
    };
  }
}
