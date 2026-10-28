import type { IExtensionCommand } from '@/presentation/commands/extensionCommand';
import {
  recommendCharacterCommand,
  recommendCards,
  type RecommendCardDependencies,
} from '@/presentation/commands/recommendCards';

export class RecommendCharacterCardsCommand implements IExtensionCommand {
  public readonly id: string = recommendCharacterCommand;

  public constructor(private readonly dependencies: RecommendCardDependencies) {}

  public run(): Promise<void> {
    return recommendCards('character', this.dependencies);
  }
}
