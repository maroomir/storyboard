import * as vscode from 'vscode';

import { AiGateway } from '../../application/ai/ai-gateway';
import { GenerateDraftUseCase } from '../../application/drafts/generate-draft-use-case';
import { NovelPipeline } from '../../application/novel/novel-pipeline';
import { VscodeFileSystem } from '../../infrastructure/vscode/vscode-file-system';
import { StoryboardLogger } from '../../core/logger';
import {
  createAiProviderRegistry,
  type AiProviderRegistry,
} from '../../services/ai/providerRegistry';
import { PostGenerationUpdateManager } from '../../services/ai/PostGenerationUpdateManager';
import { createVscodeUsageLedgerFileSystem, UsageRecorder } from '../../services/ai/UsageRecorder';
import { SecretStore } from '../../services/secrets/SecretStore';
import { ConfigBridge } from '../../services/settings/ConfigBridge';

import type { IApplicationModule } from '../lifecycle/application-module';

export interface IPlatformServices {
  readonly aiGateway: AiGateway;
  readonly aiProviderRegistry: AiProviderRegistry;
  readonly configBridge: ConfigBridge;
  readonly fileSystem: VscodeFileSystem;
  readonly generateDraftUseCase: GenerateDraftUseCase;
  readonly logger: StoryboardLogger;
  readonly novelPipeline: NovelPipeline;
  readonly postGenerationUpdates: PostGenerationUpdateManager;
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
    const postGenerationUpdates = new PostGenerationUpdateManager();
    const usageRecorder = new UsageRecorder(createVscodeUsageLedgerFileSystem(), (message): void =>
      logger.warn(message),
    );
    const aiGateway = new AiGateway(aiProviderRegistry, usageRecorder, logger);
    const fileSystem = new VscodeFileSystem();
    const generateDraftUseCase = new GenerateDraftUseCase({
      aiGateway,
      configBridge,
      fileSystem,
      logger,
      postGenerationUpdates,
    });
    const novelPipeline = new NovelPipeline({
      aiGateway,
      aiProviderRegistry,
      configBridge,
      generateDraftUseCase,
      logger,
      usageRecorder,
    });

    this.services = {
      aiGateway,
      aiProviderRegistry,
      configBridge,
      fileSystem,
      generateDraftUseCase,
      logger,
      novelPipeline,
      postGenerationUpdates,
      secretStore,
      usageRecorder,
    };
    this.disposables = [
      logger,
      postGenerationUpdates,
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
