import * as vscode from 'vscode';

import type { IStoryboardLogger } from '@storyboard/story-engine';
import { StoryboardApplication } from '@storyboard/story-app';
import { ConfigBridge, SecretStore } from '@storyboard/story-ai';
import type { StoryboardConfigurationLike } from '@storyboard/story-ai';
import { migrateVscodeSettingsToHome } from '@/infrastructure/settings/migrateVscodeSettings';
import {
  createStoryboardHomeStores,
  type StoryboardHomeStores,
} from '@/infrastructure/settings/storyboardHome';
import {
  createVscodeUsageLedgerFileSystem,
  UsageRecorder,
} from '@/infrastructure/ai/UsageRecorder';
import { OutputChannelLogger } from '@/infrastructure/vscode/logger';
import { VscodeFileSystem } from '@/infrastructure/vscode/vscodeFileSystem';
import { VscodeWorkspaceLocator } from '@/infrastructure/vscode/workspaceLocator';
import { ProposalReviewService } from '@/presentation/providers/proposalReviewService';

import { DisposableStore } from '@/bootstrap/lifecycle/disposableStore';
import type { IApplicationModule } from '@/bootstrap/lifecycle/applicationModule';

export interface IPlatformServices extends Pick<
  StoryboardApplication,
  | 'drafts'
  | 'manuscript'
  | 'cards'
  | 'novel'
  | 'studio'
  | 'aiGateway'
  | 'aiProviderRegistry'
  | 'configBridge'
  | 'secretStore'
  | 'logger'
  | 'usageMeter'
  | 'postGenerationUpdates'
> {
  readonly fileSystem: VscodeFileSystem;
  readonly homeStores: StoryboardHomeStores;
  readonly usageRecorder: UsageRecorder;
  readonly proposalReviewService: ProposalReviewService;
}

// The extension's side of the composition: only the VSCode adapters are built here. The engine
// graph they feed is assembled once, for every app, by StoryboardApplication.
export class PlatformModule implements IApplicationModule {
  private services: IPlatformServices | undefined;
  private readonly disposables = new DisposableStore();

  public initialize(context: vscode.ExtensionContext): void {
    if (this.services) {
      throw new Error('PlatformModule is already initialized.');
    }

    const logger = new OutputChannelLogger();
    const homeStores = createStoryboardHomeStores({
      workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      onInvalidFile: (error): void => reportInvalidConfigFile(error.file, error.message, logger),
    });
    const secretStore = new SecretStore(homeStores.secretStorage);
    const configBridge = new ConfigBridge({
      getConfiguration: (): StoryboardConfigurationLike => homeStores.configuration,
      onDidChangeConfiguration: homeStores.onDidChangeConfiguration,
    });
    void migrateLegacySettings(context, homeStores, logger);
    const fileSystem = new VscodeFileSystem();
    const usageRecorder = new UsageRecorder(createVscodeUsageLedgerFileSystem(), (message): void =>
      logger.warn(message),
    );
    const proposalReviewService = new ProposalReviewService(context);

    const application = new StoryboardApplication(
      {
        fileSystem,
        workspaceLocator: new VscodeWorkspaceLocator(),
        logger,
        secretStore,
        configBridge,
        usageLedger: usageRecorder,
      },
      { generator: `storyboard@${context.extension.packageJSON.version}` },
    );

    this.services = {
      drafts: application.drafts,
      manuscript: application.manuscript,
      cards: application.cards,
      novel: application.novel,
      studio: application.studio,
      aiGateway: application.aiGateway,
      aiProviderRegistry: application.aiProviderRegistry,
      configBridge: application.configBridge,
      secretStore: application.secretStore,
      logger: application.logger,
      usageMeter: application.usageMeter,
      postGenerationUpdates: application.postGenerationUpdates,
      fileSystem,
      homeStores,
      usageRecorder,
      proposalReviewService,
    };
    this.disposables.add(
      logger,
      homeStores,
      application,
      usageRecorder,
      configBridge.onDidChange((): void => logger.info('Storyboard configuration changed')),
      proposalReviewService,
    );

    logger.info('Activating Storyboard extension');
  }

  public getServices(): IPlatformServices {
    if (!this.services) {
      throw new Error('PlatformModule has not been initialized.');
    }

    return this.services;
  }

  public dispose(): void {
    this.disposables.dispose();

    this.services = undefined;
  }
}

// A settings file the author broke by hand must not take the whole extension down, but it must
// not be silent either: every read falls back to defaults and the author is told which file.
const reportedInvalidFiles = new Set<string>();

function reportInvalidConfigFile(file: string, message: string, logger: IStoryboardLogger): void {
  logger.warn(message);

  if (reportedInvalidFiles.has(file)) {
    return;
  }

  reportedInvalidFiles.add(file);
  void vscode.window
    .showWarningMessage(`${message} 고칠 때까지 기본값으로 동작합니다.`, '파일 열기')
    .then((choice) => {
      if (choice === '파일 열기') {
        void vscode.window.showTextDocument(vscode.Uri.file(file));
      }
    });
}

async function migrateLegacySettings(
  context: vscode.ExtensionContext,
  homeStores: StoryboardHomeStores,
  logger: IStoryboardLogger,
): Promise<void> {
  try {
    const result = await migrateVscodeSettingsToHome({
      vscodeConfiguration: vscode.workspace.getConfiguration('storyboard'),
      vscodeSecrets: context.secrets,
      homeConfiguration: homeStores.configuration,
      homeSecrets: homeStores.secretStorage,
      hasWorkspaceConfigFile: homeStores.workspaceConfigFile !== undefined,
    });

    if (result.movedSettings.length === 0 && result.movedApiKeys.length === 0) {
      return;
    }

    logger.info(
      `VSCode 설정 ${result.movedSettings.length}개와 API 키 ${result.movedApiKeys.length}개를 ${homeStores.paths.home} 으로 옮겼습니다.`,
    );
    const choice = await vscode.window.showInformationMessage(
      `Storyboard 설정을 ${homeStores.paths.configFile} 로 옮겼습니다. 이제 확장과 CLI 가 같은 설정을 씁니다.`,
      '파일 열기',
    );

    if (choice === '파일 열기') {
      await vscode.window.showTextDocument(vscode.Uri.file(homeStores.paths.configFile));
    }
  } catch (error) {
    logger.error('VSCode 설정을 ~/.storyboard 로 옮기지 못했습니다.', error);
  }
}
