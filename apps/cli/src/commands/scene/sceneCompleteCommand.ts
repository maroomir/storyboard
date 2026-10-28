import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { flagBoolean } from '@/cliArguments';
import { success } from '@/commands/outcomes';
import type { CompleteStoryScenesProposal } from '@storyboard/story-engine';

export class SceneCompleteCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'scene complete',
    writesWorkspace: true,
    group: '씬',
    usage: 'scene complete',
    summary: '끝번호 뒤에 붙일 완결 씬을 만듭니다 (--dry-run 은 제안만)',
    flags: ['dry-run'],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const proposal: CompleteStoryScenesProposal = await container.novel.completeScenes({
      workspaceRoot: container.workspaceRoot,
    });

    if (flagBoolean(args.flags, 'dry-run')) {
      return success(`완결 씬 제안 ${proposal.scenes.length}건`, proposal);
    }

    const { writtenFileNames: written, skippedFileNames: skipped } =
      await container.novel.applyCompletedScenes(container.workspaceRoot, proposal.scenes);

    return success(
      skipped.length === 0
        ? `완결 씬 ${written.length}개를 만들었습니다.`
        : `완결 씬 ${written.length}개를 만들고 이미 있는 ${skipped.length}개는 건너뛰었습니다.`,
      {
        written,
        skipped,
        centralQuestion: proposal.centralQuestion,
        climaxChoice: proposal.climaxChoice,
      },
    );
  }
}
