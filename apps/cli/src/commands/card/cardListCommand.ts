import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import { type CommandSpec, cardCategories } from '@/commands/catalog';
import {
  CardListRow,
  cardCategoryLabels,
  cardIdFromUnreadableFileName,
} from '@/commands/card/cardViews';
import { failure, success } from '@/commands/outcomes';
import type { BibleSubjectKind } from '@storyboard/story-model';

export class CardListCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'card list',
    group: '카드와 정전',
    usage: `card list [${cardCategories.join('|')}]`,
    summary: '인물·배경 카드를 봅니다 (종류를 적으면 그 종류만)',
    examples: ['storyboard card list', 'storyboard card list character --json'],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const requested: string | undefined = args.positionals[0];
    const categories: BibleSubjectKind[] = cardCategories.filter(
      (category) => requested === undefined || category === requested,
    );

    if (categories.length === 0) {
      return failure(
        `카드 종류를 알 수 없습니다: ${requested}\n쓸 수 있는 값: ${cardCategories.join(', ')}`,
      );
    }

    const cards: CardListRow[] = (
      await Promise.all(
        categories.map(async (category) =>
          (await container.cards.list(container.workspaceRoot, category)).map((summary) => ({
            category,
            id:
              summary.error === undefined ? summary.id : cardIdFromUnreadableFileName(summary.name),
            name: summary.error === undefined ? summary.name : null,
            role: summary.role ?? null,
            error: summary.error ?? null,
          })),
        ),
      )
    ).flat();

    if (cards.length === 0) {
      return success('카드가 없습니다.', { cards: [] });
    }

    return success(
      cards
        .map(
          (card) =>
            `${card.id}\t${card.name ?? `읽을 수 없음: ${card.error}`}\t${cardCategoryLabels[card.category]}`,
        )
        .join('\n'),
      { cards },
    );
  }
}
