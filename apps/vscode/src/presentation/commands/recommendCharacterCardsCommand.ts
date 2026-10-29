import { storyboardCommandIds } from '@/contributionIds';
import {
  RecommendCardsCommandBase,
  type RecommendCardsCommandDependencies,
} from '@/presentation/commands/recommendCardsCommandBase';

export class RecommendCharacterCardsCommand extends RecommendCardsCommandBase {
  public readonly id: string = storyboardCommandIds.characterRecommend;

  public constructor(dependencies: RecommendCardsCommandDependencies) {
    super(dependencies);
  }

  public run(): Promise<void> {
    return this.recommend('character');
  }
}
