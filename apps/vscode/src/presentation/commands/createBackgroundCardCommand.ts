import { storyboardCommandIds } from '@/contributionIds';
import {
  CreateCardCommandBase,
  type CreateCardCommandDependencies,
} from '@/presentation/commands/createCardCommandBase';

export class CreateBackgroundCardCommand extends CreateCardCommandBase {
  public readonly id: string = storyboardCommandIds.backgroundCreate;

  public constructor(dependencies: CreateCardCommandDependencies) {
    super(dependencies);
  }

  public run(): Promise<void> {
    return this.create('location');
  }
}
