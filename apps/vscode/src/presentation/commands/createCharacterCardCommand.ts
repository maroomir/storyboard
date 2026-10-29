import { storyboardCommandIds } from '@/contributionIds';
import type { IExtensionCommand } from '@/presentation/commands/extensionCommand';
import { createCard, type CreateCardCommandDependencies } from '@/presentation/commands/createCard';

export class CreateCharacterCardCommand implements IExtensionCommand {
  public readonly id: string = storyboardCommandIds.characterCreate;

  public constructor(private readonly dependencies: CreateCardCommandDependencies) {}

  public run(): Promise<void> {
    return createCard('character', this.dependencies.cards);
  }
}
