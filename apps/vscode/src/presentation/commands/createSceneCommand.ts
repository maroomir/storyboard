import type { IExtensionCommand } from '@/presentation/commands/extensionCommand';
import {
  createNewScene,
  createSceneCommand,
  type CreateSceneCommandDependencies,
} from '@/presentation/commands/newScene';

export class CreateSceneCommand implements IExtensionCommand {
  public readonly id: string = createSceneCommand;

  public constructor(private readonly dependencies: CreateSceneCommandDependencies) {}

  public run(): Promise<void> {
    return createNewScene(this.dependencies.configBridge);
  }
}
