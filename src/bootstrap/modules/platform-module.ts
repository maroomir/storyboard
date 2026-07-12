import * as vscode from 'vscode';

import { StoryboardLogger } from '../../core/logger';
import {
  createAiProviderRegistry,
  type AiProviderRegistry,
} from '../../services/ai/providerRegistry';
import { createVscodeUsageLedgerFileSystem, UsageRecorder } from '../../services/ai/UsageRecorder';
import { SecretStore } from '../../services/secrets/SecretStore';
import { ConfigBridge } from '../../services/settings/ConfigBridge';

import type { IApplicationModule } from '../lifecycle/application-module';

export interface IPlatformServices {
  readonly aiProviderRegistry: AiProviderRegistry;
  readonly configBridge: ConfigBridge;
  readonly logger: StoryboardLogger;
  readonly secretStore: SecretStore;
  readonly usageRecorder: UsageRecorder;
}

export class PlatformModule implements IApplicationModule {
  private services: IPlatformServices | undefined;
  private disposables: vscode.Disposable[] = [];

  public initialize(context: vscode.ExtensionContext): void {
    if (this.services) {
      throw new Error('PlatformModule is already initialized.');
    }

    const logger = new StoryboardLogger();
    const secretStore = new SecretStore(context.secrets);
    const configBridge = new ConfigBridge({
      getConfiguration: (): vscode.WorkspaceConfiguration =>
        vscode.workspace.getConfiguration('storyboard'),
      onDidChangeConfiguration: (listener): vscode.Disposable =>
        vscode.workspace.onDidChangeConfiguration(listener),
    });
    const aiProviderRegistry = createAiProviderRegistry({ secretStore, configBridge });
    const usageRecorder = new UsageRecorder(createVscodeUsageLedgerFileSystem(), (message): void =>
      logger.warn(message),
    );

    this.services = { aiProviderRegistry, configBridge, logger, secretStore, usageRecorder };
    this.disposables = [
      logger,
      usageRecorder,
      configBridge.onDidChange((): void => logger.info('Storyboard configuration changed')),
    ];

    logger.info('Activating Storyboard extension');
  }

  public getServices(): IPlatformServices {
    if (!this.services) {
      throw new Error('PlatformModule has not been initialized.');
    }

    return this.services;
  }

  public dispose(): void {
    for (const disposable of this.disposables.splice(0).reverse()) {
      disposable.dispose();
    }

    this.services = undefined;
  }
}
