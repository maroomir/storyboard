import * as vscode from 'vscode';

import { registerOpenRelationGraphCommand } from '../../commands/openRelationGraph';
import { registerOpenSettingsCommand } from '../../commands/openSettings';
import { RelationGraphProvider } from '../../providers/RelationGraphProvider';
import { SettingsPanelProvider } from '../../providers/SettingsPanelProvider';
import { registerSidebarStudioProvider } from '../../providers/SidebarStudioProvider';

import { DisposableStore } from '../lifecycle/disposable-store';
import type { IApplicationModule } from '../lifecycle/application-module';
import type { IPlatformServices } from './platform-module';

export class WorkbenchModule implements IApplicationModule {
  private readonly disposables = new DisposableStore();

  public constructor(private readonly platform: IPlatformServices) {}

  public initialize(context: vscode.ExtensionContext): void {
    const { aiProviderRegistry, configBridge, secretStore } = this.platform;
    const relationGraphPanel = new RelationGraphProvider({ aiProviderRegistry });
    const settingsPanel = new SettingsPanelProvider({
      aiProviderRegistry,
      secretStore,
      configBridge,
    });

    this.disposables.add(
      registerSidebarStudioProvider(context),
      registerOpenRelationGraphCommand(context, relationGraphPanel),
      registerOpenSettingsCommand(context, settingsPanel),
      relationGraphPanel,
      settingsPanel,
    );
  }

  public dispose(): void {
    this.disposables.dispose();
  }
}
