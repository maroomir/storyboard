import type { IExtensionCommand } from '@/presentation/commands/extensionCommand';
import {
  createCharacterCommand,
  createCard,
  type CreateCardCommandDependencies,
} from '@/presentation/commands/createCard';

export class CreateCharacterCardCommand implements IExtensionCommand {
  public readonly id: string = createCharacterCommand;

  public constructor(private readonly dependencies: CreateCardCommandDependencies) {}

  public run(): Promise<void> {
    return createCard('character', this.dependencies.cards);
  }
}
