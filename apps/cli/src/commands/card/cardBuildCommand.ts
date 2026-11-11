import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { describeCardBuild } from '@/commands/card/cardViews';
import { flagBoolean } from '@/cliArguments';
import { success } from '@/commands/outcomes';
import type {
  BuildStoryCardsProposal,
  ProposeStoryCardTargetsResult,
} from '@storyboard/story-engine';

export class CardBuildCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'card build',
    writesWorkspace: true,
    group: '카드',
    usage: 'card build',
    summary:
      '씬만 읽어 카드를 만듭니다 (--dry-run 은 구성안만, --propose 면 있던 카드의 변경은 세션 제안으로)',
    flags: ['dry-run', 'propose'],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const proposal: BuildStoryCardsProposal = await container.cards.buildFromScenes({
      workspaceRoot: container.workspaceRoot,
    });

    if (flagBoolean(args.flags, 'dry-run')) {
      return success(`카드 구성안 ${proposal.targets.length}건`, proposal);
    }

    if (flagBoolean(args.flags, 'propose')) {
      const proposed: ProposeStoryCardTargetsResult = await container.cards.proposeBuildTargets(
        container.workspaceRoot,
        proposal.targets,
      );
      return success(
        [
          describeCardBuild(proposed.writtenIds.length, proposed.needsIdNames),
          ...(proposed.proposedIds.length === 0
            ? []
            : [`있던 카드 ${proposed.proposedIds.join(', ')} 의 변경은 제안으로 남겼습니다: storyboard card apply`]),
        ].join('\n'),
        proposed,
      );
    }

    const { writtenIds: written, needsIdNames: needsId } = await container.cards.applyBuildTargets(
      container.workspaceRoot,
      proposal.targets,
    );

    return success(describeCardBuild(written.length, needsId), { written, needsId });
  }
}
