import type { IExtensionCommand } from '@/presentation/commands/extensionCommand';
import {
  createBackgroundCommand,
  createCard,
  type CreateCardCommandDependencies,
} from '@/presentation/commands/createCard';

export class CreateBackgroundCardCommand implements IExtensionCommand {
  public readonly id: string = createBackgroundCommand;

  public constructor(private readonly dependencies: CreateCardCommandDependencies) {}

  public run(): Promise<void> {
    return createCard('location', this.dependencies.cards);
  }
}
