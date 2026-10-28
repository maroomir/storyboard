import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { flagBoolean } from '@/cliArguments';
import { describeNothingToPromote, success } from '@/commands/outcomes';
import type { PrepareBibleCandidatePromotionResult } from '@storyboard/story-engine';

export class CanonPromoteCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'canon promote',
    writesWorkspace: true,
    group: '카드와 정전',
    usage: 'canon promote',
    summary: '초안에서 추출한 설정 후보를 정전에 반영합니다',
    flags: ['dry-run'],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const prepared: PrepareBibleCandidatePromotionResult =
      await container.cards.prepareBiblePromotion(container.workspaceRoot);

    if (prepared.kind !== 'ready') {
      return success(describeNothingToPromote(prepared.kind), prepared);
    }

    if (flagBoolean(args.flags, 'dry-run')) {
      return success(`승격 후보 ${prepared.facts.length}건`, prepared.facts);
    }

    await container.cards.promoteBibleFacts(container.workspaceRoot, prepared.facts);
    return success(`정전에 ${prepared.facts.length}건을 반영했습니다.`, prepared.facts);
  }
}
