import * as vscode from 'vscode';

import { registerHelloWorldCommand } from '../../commands/helloWorld';
import { registerImportSeedCommands } from '../../commands/importSeed';
import { registerInitCommand } from '../../commands/init';
import { registerSetApiKeyCommand } from '../../commands/setApiKey';
import { registerStoryboardWorkspaceContext } from '../../infrastructure/vscode/storyboardWorkspaceContext';

import { DisposableStore } from '../lifecycle/disposableStore';
import type { IApplicationModule } from '../lifecycle/applicationModule';
import type { IPlatformServices } from './platformModule';

export class ProjectModule implements IApplicationModule {
  private readonly disposables = new DisposableStore();

  public constructor(private readonly platform: IPlatformServices) {}

  public initialize(context: vscode.ExtensionContext): void {
    this.disposables.add(
      registerStoryboardWorkspaceContext(context),
      registerHelloWorldCommand(),
      registerInitCommand({ logger: this.platform.logger }),
      registerImportSeedCommands({
        decodeSeedUseCase: this.platform.decodeSeedUseCase,
        logger: this.platform.logger,
        seedProjectUseCase: this.platform.seedProjectUseCase,
      }),
      registerSetApiKeyCommand({ secretStore: this.platform.secretStore }),
    );
  }

  public dispose(): void {
    this.disposables.dispose();
  }
}
