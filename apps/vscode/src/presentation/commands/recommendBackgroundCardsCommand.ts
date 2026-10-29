import { storyboardCommandIds } from '@/contributionIds';
import type { IExtensionCommand } from '@/presentation/commands/extensionCommand';
import {
  recommendCards,
  type RecommendCardDependencies,
} from '@/presentation/commands/recommendCards';

export class RecommendBackgroundCardsCommand implements IExtensionCommand {
  public readonly id: string = storyboardCommandIds.backgroundRecommend;

  public constructor(private readonly dependencies: RecommendCardDependencies) {}

  public run(): Promise<void> {
    return recommendCards('background', this.dependencies);
  }
}
