import * as vscode from 'vscode';

import { registerOpenRelationGraphCommand } from '@/presentation/commands/openRelationGraph';
import { registerOpenSettingsCommand } from '@/presentation/commands/openSettings';
import { RelationGraphProvider } from '@/presentation/providers/RelationGraphProvider';
import { SettingsPanelProvider } from '@/presentation/providers/SettingsPanelProvider';
import { registerSidebarStudioProvider } from '@/presentation/providers/SidebarStudioProvider';

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
      logger,
      proposalReviewService,
      secretStore,
      studioChatUseCase,
    } = this.platform;
    const relationGraphPanel = new RelationGraphProvider({ aiProviderRegistry });
    const settingsPanel = new SettingsPanelProvider({
      aiProviderRegistry,
      secretStore,
      configBridge,
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
      relationGraphPanel,
      settingsPanel,
    );
  }

  public dispose(): void {
    this.disposables.dispose();
  }
}
