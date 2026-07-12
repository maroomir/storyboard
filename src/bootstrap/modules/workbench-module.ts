import * as vscode from 'vscode';

import { registerOpenRelationGraphCommand } from '../../commands/openRelationGraph';
import { registerOpenSettingsCommand } from '../../commands/openSettings';
import { registerSidebarStudioProvider } from '../../providers/SidebarStudioProvider';

import type { IApplicationModule } from '../lifecycle/application-module';
import type { IPlatformServices } from './platform-module';

export class WorkbenchModule implements IApplicationModule {
  private disposables: vscode.Disposable[] = [];

  public constructor(private readonly platform: IPlatformServices) {}

  public initialize(context: vscode.ExtensionContext): void {
    const { aiProviderRegistry, configBridge, secretStore } = this.platform;

    this.disposables.push(
      registerSidebarStudioProvider(context),
      registerOpenRelationGraphCommand(context, { aiProviderRegistry }),
      registerOpenSettingsCommand(context, { aiProviderRegistry, secretStore, configBridge }),
    );
  }

  public dispose(): void {
    for (const disposable of this.disposables.splice(0).reverse()) {
      disposable.dispose();
    }
  }
}
