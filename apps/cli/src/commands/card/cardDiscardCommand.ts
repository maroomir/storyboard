import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { cardIdPattern } from '@/commands/card/cardArguments';
import { failure, success } from '@/commands/outcomes';
import type { CliContainer } from '@/container';
import type { PendingCardSummary } from '@storyboard/story-engine';

export class CardDiscardCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'card discard',
    writesWorkspace: true,
    group: '카드',
    usage: 'card discard [<slug> …]',
    summary: '세션에 남은 카드 제안을 버립니다 (slug 를 여럿 줄 수 있고, 없으면 전부)',
    examples: ['storyboard card discard hana', 'storyboard card discard'],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const invalidId: string | undefined = args.positionals.find((id) => !cardIdPattern.test(id));

    if (invalidId !== undefined) {
      return failure(`카드 slug 가 올바르지 않습니다: ${invalidId}`);
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
      return success('버릴 제안이 없습니다.', { cards: [] });
    }

    return success(['제안을 버렸습니다.', `  ${targets.join(', ')}`].join('\n'), {
      cards: targets,
    });
  }
}
