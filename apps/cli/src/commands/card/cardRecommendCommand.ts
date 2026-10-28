import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import { type CommandSpec, cardCategories } from '@/commands/catalog';
import { cardCategoryFrom, describeMissingCardCategory } from '@/commands/card/cardArguments';
import { failure, success } from '@/commands/outcomes';
import type { RecommendCardsResult } from '@storyboard/story-engine';
import type { BibleSubjectKind } from '@storyboard/story-model';

export class CardRecommendCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'card recommend',
    group: '카드와 정전',
    usage: `card recommend <${cardCategories.join('|')}>`,
    summary: '카드가 없는 인물·배경을 찾습니다 (읽기 전용)',
    examples: ['storyboard card recommend character'],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const category: BibleSubjectKind | undefined = cardCategoryFrom(args);

    if (category === undefined) {
      return failure(describeMissingCardCategory('card recommend'));
    }

    const recommendation: RecommendCardsResult = await container.cards.recommend({
      category,
      workspaceRoot: container.workspaceRoot,
    });

    if (!recommendation.ok) {
      return failure(
        recommendation.kind === 'cancelled' ? '취소했습니다.' : recommendation.message,
        recommendation,
      );
    }

    return recommendation.kind === 'no_sources'
      ? success('훑을 씬이나 초안이 없습니다.', [])
      : success(
          `카드가 없는 ${category} ${recommendation.recommendations.length}건`,
          recommendation.recommendations,
        );
  }
}
