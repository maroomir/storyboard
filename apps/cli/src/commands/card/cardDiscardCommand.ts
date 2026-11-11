import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { cardIdPattern } from '@/commands/card/cardArguments';
import { flagString } from '@/cliArguments';
import { failure, success } from '@/commands/outcomes';
import type { CliContainer } from '@/container';
import type { PendingCardSummary } from '@storyboard/story-engine';

export class CardDiscardCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'card discard',
    writesWorkspace: true,
    group: '카드',
    usage: 'card discard <id>',
    summary: '반영하지 않은 카드 제안을 버립니다 (id 를 여럿 줄 수 있고, 없으면 전부)',
    flags: ['change'],
    examples: ['storyboard card discard hana', 'storyboard card discard'],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const invalidId: string | undefined = args.positionals.find((id) => !cardIdPattern.test(id));

    if (invalidId !== undefined) {
      return failure(`카드 id 가 올바르지 않습니다: ${invalidId}`);
    }

    if (flagString(args.flags, 'change') !== undefined) {
      return failure('세션의 제안은 카드 단위로 버립니다. --change 없이 card discard <id> 를 쓰세요.');
    }

    return await this.discardCards(container, args.positionals);
  }

  private async discardCards(
    container: CliContainer,
    positionals: readonly string[],
  ): Promise<CommandOutcome> {
    const pending: readonly PendingCardSummary[] = await container.cards.listPendingCards(
      container.workspaceRoot,
    );
    const requested: ReadonlySet<string> = new Set(positionals);
    const targets: readonly string[] = pending
      .map((card) => card.slug)
      .filter((slug) => requested.size === 0 || requested.has(slug));

    for (const slug of targets) {
      await container.cards.discardPending(container.workspaceRoot, slug);
    }

    if (targets.length === 0) {
      return success('버릴 후보가 없습니다.', { cards: [] });
    }

    return success(['후보를 버렸습니다.', `  ${targets.join(', ')}`].join('\n'), {
      cards: targets,
    });
  }
}
