import { storyboardCommandIds } from '@/contributionIds';
import {
  CreateCardCommandBase,
  type CreateCardCommandDependencies,
} from '@/presentation/commands/createCardCommandBase';

export class CreateCharacterCardCommand extends CreateCardCommandBase {
  public readonly id: string = storyboardCommandIds.characterCreate;

  public constructor(dependencies: CreateCardCommandDependencies) {
    super(dependencies);
  }

  public run(): Promise<void> {
    return this.create('character');
  }
}
