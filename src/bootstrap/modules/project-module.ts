import * as vscode from 'vscode';

import { registerHelloWorldCommand } from '../../commands/helloWorld';
import { registerImportSeedCommands } from '../../commands/importSeed';
import { registerInitCommand } from '../../commands/init';
import { registerSetApiKeyCommand } from '../../commands/setApiKey';
import { registerStoryboardWorkspaceContext } from '../../core/storyboardWorkspaceContext';

import type { IApplicationModule } from '../lifecycle/application-module';
import type { IPlatformServices } from './platform-module';

export class ProjectModule implements IApplicationModule {
  private disposables: vscode.Disposable[] = [];

  public constructor(private readonly platform: IPlatformServices) {}

  public initialize(context: vscode.ExtensionContext): void {
    this.disposables.push(
      registerStoryboardWorkspaceContext(context),
      registerHelloWorldCommand(),
      registerInitCommand({ logger: this.platform.logger }),
      registerImportSeedCommands({ logger: this.platform.logger }),
      registerSetApiKeyCommand({ secretStore: this.platform.secretStore }),
    );
  }

  public dispose(): void {
    for (const disposable of this.disposables.splice(0).reverse()) {
      disposable.dispose();
    }
  }
}
