import * as vscode from 'vscode';

import { OpenRelationGraphCommand } from '@/presentation/commands/openRelationGraphCommand';
import { OpenSettingsCommand } from '@/presentation/commands/openSettingsCommand';
import {
  ChooseProviderCommand,
  nudgeToChooseProvider,
} from '@/presentation/commands/chooseProviderCommand';
import { resolveStoryboardWorkspaceRoot } from '@/infrastructure/vscode/workspace';
import { RelationGraphProvider } from '@/presentation/providers/RelationGraphProvider';
import { SettingsPanelProvider } from '@/presentation/providers/SettingsPanelProvider';
import { SidebarStudioProvider } from '@/presentation/providers/SidebarStudioProvider';
import { StudioToolDiagnostics } from '@/presentation/providers/studioToolDiagnostics';
import { ProviderStatusBarItem } from '@/presentation/statusBar/providerStatusBarItem';
import { vscodeFileSystem } from '@/infrastructure/vscode/vscodeFileSystem';
import { StudioFollowUpRepository, StudioSessionRepository } from '@storyboard/story-engine';

import { CommandRegistrar } from '@/bootstrap/commandRegistrar';
import { DisposableStore } from '@/bootstrap/lifecycle/disposableStore';
import type { IApplicationModule } from '@/bootstrap/lifecycle/applicationModule';
import type { IPlatformServices } from './platformModule';

export class WorkbenchModule implements IApplicationModule {
  private readonly disposables: DisposableStore = new DisposableStore();

  public constructor(private readonly platform: IPlatformServices) {}

  public initialize(context: vscode.ExtensionContext): void {
    const {
      aiGateway,
      aiProviderRegistry,
      cards,
      configBridge,
      homeStores,
      logger,
      proposalReviewService,
      secretStore,
      studio,
    } = this.platform;
    const configFiles = (): { readonly user: string; readonly workspace?: string } => ({
      user: homeStores.paths.configFile,
      ...(homeStores.workspaceConfigFile === undefined
        ? {}
        : { workspace: homeStores.workspaceConfigFile }),
    });
    const relationGraphPanel: RelationGraphProvider = new RelationGraphProvider({
      aiProviderRegistry,
    });
    const settingsPanel: SettingsPanelProvider = new SettingsPanelProvider({
      aiProviderRegistry,
      secretStore,
      configBridge,
      configFiles,
    });

    this.disposables.add(
      new SidebarStudioProvider(
        context.extensionUri,
        new StudioSessionRepository(vscodeFileSystem),
        studio,
        aiGateway,
        cards,
        new StudioToolDiagnostics(),
        proposalReviewService,
        new StudioFollowUpRepository(vscodeFileSystem),
        configBridge,
        logger,
      ).register(),
      new CommandRegistrar().register([
        new OpenRelationGraphCommand(context, relationGraphPanel),
        new OpenSettingsCommand(context, settingsPanel),
        new ChooseProviderCommand({ configBridge, registry: aiProviderRegistry, secretStore }),
      ]),
      new ProviderStatusBarItem({ configBridge, configFiles }).register(),
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
