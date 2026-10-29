import { storyboardCommandIds } from '@/contributionIds';
import type { IExtensionCommand } from '@/presentation/commands/extensionCommand';
import { createCard, type CreateCardCommandDependencies } from '@/presentation/commands/createCard';

export class CreateBackgroundCardCommand implements IExtensionCommand {
  public readonly id: string = storyboardCommandIds.backgroundCreate;

  public constructor(private readonly dependencies: CreateCardCommandDependencies) {}

  public run(): Promise<void> {
    return createCard('location', this.dependencies.cards);
  }
}
