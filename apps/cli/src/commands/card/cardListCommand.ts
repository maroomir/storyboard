import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import { type CommandSpec, cardCategories, cardKinds } from '@/commands/catalog';
import type { CliContainer } from '@/container';
import { describeCard } from '@/commands/card/narratorViews';
import {
  CardListRow,
  cardCategoryLabels,
  cardIdFromUnreadableFileName,
} from '@/commands/card/cardViews';
import { failure, success } from '@/commands/outcomes';
import type { BibleSubjectKind, NarratorCard } from '@storyboard/story-model';

export class CardListCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'card list',
    group: '카드',
    usage: `card list [${cardKinds.join('|')}]`,
    summary: '인물·배경·서술자 카드를 봅니다 (종류를 적으면 그 종류만)',
    examples: ['storyboard card list', 'storyboard card list character --json'],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const requested: string | undefined = args.positionals[0];
    if (requested === 'narrator') {
      return await this.listNarrators(container);
    }

    const categories: BibleSubjectKind[] = cardCategories.filter(
      (category) => requested === undefined || category === requested,
    );

    if (categories.length === 0) {
      return failure(
        `카드 종류를 알 수 없습니다: ${requested}\n쓸 수 있는 값: ${cardKinds.join(', ')}`,
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

  private async listNarrators(container: CliContainer): Promise<CommandOutcome> {
    const narrators: NarratorCard[] = [
      ...(await container.cards.listNarrators(container.workspaceRoot)).values(),
    ];

    return narrators.length === 0
      ? success('서술자 카드가 없습니다. 작품 계약의 시점 하나가 모든 씬에 적용됩니다.', { cards: [] })
      : success(
          narrators.map((card) => `${card.id}\t${card.name}\t${describeCard(card)}`).join('\n'),
          { cards: narrators.map((card) => ({ category: 'narrator', id: card.id, name: card.name })) },
        );
  }
}
