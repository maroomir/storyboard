import * as vscode from 'vscode';

import { registerOpenRelationGraphCommand } from '@/presentation/commands/openRelationGraph';
import { registerOpenSettingsCommand } from '@/presentation/commands/openSettings';
import {
  nudgeToChooseProvider,
  registerChooseProviderCommand,
} from '@/presentation/commands/chooseProvider';
import { resolveStoryboardWorkspaceRoot } from '@/infrastructure/vscode/workspace';
import { RelationGraphProvider } from '@/presentation/providers/RelationGraphProvider';
import { SettingsPanelProvider } from '@/presentation/providers/SettingsPanelProvider';
import { registerSidebarStudioProvider } from '@/presentation/providers/SidebarStudioProvider';
import { registerProviderStatusBarItem } from '@/presentation/statusBar/providerStatusBarItem';

import { DisposableStore } from '@/bootstrap/lifecycle/disposableStore';
import type { IApplicationModule } from '@/bootstrap/lifecycle/applicationModule';
import type { IPlatformServices } from './platformModule';

export class WorkbenchModule implements IApplicationModule {
  private readonly disposables = new DisposableStore();

  public constructor(private readonly platform: IPlatformServices) {}

  public initialize(context: vscode.ExtensionContext): void {
    const {
      aiGateway,
      aiProviderRegistry,
      collectCardProposalsUseCase,
      createCardUseCase,
      configBridge,
      homeStores,
      logger,
      proposalReviewService,
      secretStore,
      studioChatUseCase,
    } = this.platform;
    const configFiles = (): { readonly user: string; readonly workspace?: string } => ({
      user: homeStores.paths.configFile,
      ...(homeStores.workspaceConfigFile === undefined
        ? {}
        : { workspace: homeStores.workspaceConfigFile }),
    });
    const relationGraphPanel = new RelationGraphProvider({ aiProviderRegistry });
    const settingsPanel = new SettingsPanelProvider({
      aiProviderRegistry,
      secretStore,
      configBridge,
      configFiles,
    });

    this.disposables.add(
      registerSidebarStudioProvider(
        context,
        studioChatUseCase,
        aiGateway,
        collectCardProposalsUseCase,
        createCardUseCase,
        proposalReviewService,
        configBridge,
        logger,
      ),
      registerOpenRelationGraphCommand(context, relationGraphPanel),
      registerOpenSettingsCommand(context, settingsPanel),
      registerProviderStatusBarItem({ configBridge, configFiles }),
      registerChooseProviderCommand({ configBridge, registry: aiProviderRegistry, secretStore }),
      relationGraphPanel,
      settingsPanel,
    );

    void resolveStoryboardWorkspaceRoot().then((root) => {
      if (root !== undefined) {
        return nudgeToChooseProvider({ configBridge, registry: aiProviderRegistry, secretStore });
      }

      return undefined;
    });
  }

  public dispose(): void {
    this.disposables.dispose();
  }
}
