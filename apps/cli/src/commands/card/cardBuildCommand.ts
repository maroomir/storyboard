import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { describeCardBuild } from '@/commands/card/cardViews';
import { flagBoolean } from '@/cliArguments';
import { success } from '@/commands/outcomes';
import type { BuildStoryCardsProposal } from '@storyboard/story-engine';

export class CardBuildCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'card build',
    writesWorkspace: true,
    group: '카드와 정전',
    usage: 'card build',
    summary: '씬만 읽어 카드를 만듭니다 (--dry-run 은 제안만)',
    flags: ['dry-run'],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const proposal: BuildStoryCardsProposal = await container.cards.buildFromScenes({
      workspaceRoot: container.workspaceRoot,
    });

    if (flagBoolean(args.flags, 'dry-run')) {
      return success(`카드 구성안 ${proposal.targets.length}건`, proposal);
    }

    const { writtenIds: written, needsIdNames: needsId } = await container.cards.applyBuildTargets(
      container.workspaceRoot,
      proposal.targets,
    );

    return success(describeCardBuild(written.length, needsId), { written, needsId });
  }
}
