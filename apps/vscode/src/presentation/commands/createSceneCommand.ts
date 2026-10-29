import { storyboardCommandIds } from '@/contributionIds';
import type { IExtensionCommand } from '@/presentation/commands/extensionCommand';
import {
  createNewScene,
  type CreateSceneCommandDependencies,
} from '@/presentation/commands/newScene';

export class CreateSceneCommand implements IExtensionCommand {
  public readonly id: string = storyboardCommandIds.sceneCreate;

  public constructor(private readonly dependencies: CreateSceneCommandDependencies) {}

  public run(): Promise<void> {
    return createNewScene(this.dependencies.configBridge);
  }
}
