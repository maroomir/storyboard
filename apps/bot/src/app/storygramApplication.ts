import { GitClient, PushScheduler, SyncService, inspectWorkspaceRepository } from '@storyboard/story-git';

import { ChatContext } from '../chat/context';
import {
  createBibleHandler,
  createCardsHandler,
  createScenesHandler,
  createShowHandler,
  createStartHandler,
  createStatusHandler,
  createSyncHandler,
} from '../chat/handlers/read';
import { createRenameHandler, createSetHandler } from '../chat/handlers/edit';
import type { IncomingUpdate } from '../chat/ports';
import { CommandRegistry } from '../chat/registry';
import { UpdateRouter } from '../chat/router';
import type { StorygramConfig } from '../config/config';
import { ContentService } from '../content/contentService';
import { TelegramGateway } from '../telegram/gateway';
import { createAllowlist } from '../telegram/allowlist';
import type { Logger } from '../util/logger';
import { MutateGate, createDefaultTrackedPathPredicate } from '../workspace/mutateGate';
import { WorkspaceStore } from '../workspace/workspaceStore';

export interface StorygramApplicationOptions {
  readonly config: StorygramConfig;
  readonly logger: Logger;
}

// Composition root: builds the object graph once and owns the process lifecycle. Nothing else in
// the bot constructs its collaborators.
export class StorygramApplication {
  private readonly logger: Logger;
  private readonly store: WorkspaceStore;
  private readonly git: GitClient;
  private readonly sync: SyncService;
  private readonly pushScheduler: PushScheduler;
  private readonly content: ContentService;
  private readonly gateway: TelegramGateway;
  private readonly registry = new CommandRegistry();
  private readonly router: UpdateRouter;

  public constructor(options: StorygramApplicationOptions) {
    const { config, logger } = options;
    this.logger = logger;

    this.store = new WorkspaceStore(config.workspace.path);
    this.git = new GitClient(config.workspace.path);
    this.sync = new SyncService(this.git, { remote: config.workspace.remote }, logger);
    this.pushScheduler = new PushScheduler(
      config.workspace.pushDebounceSec * 1000,
      config.workspace.syncIntervalSec * 1000,
      () => {
        this.sync.syncNow();
      },
    );
    this.sync.setPushRequest(() => this.pushScheduler.requestPush());

    const gate = new MutateGate(this.store, this.git, this.sync, logger, {
      isTrackedPath: createDefaultTrackedPathPredicate(),
    });
    this.content = new ContentService(this.store, gate);

    for (const handler of [
      createStartHandler(),
      createStatusHandler(),
      createCardsHandler(),
      createShowHandler(),
      createScenesHandler(),
      createBibleHandler(),
      createSyncHandler(),
      createRenameHandler(),
      createSetHandler(),
    ]) {
      this.registry.register(handler);
    }

    this.gateway = new TelegramGateway({
      botToken: config.telegram.botToken,
      allowlist: createAllowlist(config.telegram),
      logger,
    });

    // The gateway takes its handler at start(), which is what breaks the gateway/router cycle.
    this.router = new UpdateRouter({
      sender: this.gateway,
      registry: this.registry,
      buildContext: (update: IncomingUpdate) => this.buildContext(update),
      logger,
    });
  }

  public async start(): Promise<void> {
    await this.store.assertIsWorkspace();

    const repository = inspectWorkspaceRepository(this.store.root);
    if (repository.status !== 'ready') {
      // Editing stays blocked until the workspace can hold commits; reads still work.
      this.logger.warn(`${repository.detail} (편집 명령은 저장소가 준비될 때까지 거부됩니다.)`);
    }

    // The native command menu is cosmetic; a Telegram hiccup here must not stop the bot.
    try {
      await this.gateway.setCommandMenu(
        this.registry.list().map((handler) => ({
          command: handler.command.replace(/^\//, ''),
          description: handler.description,
        })),
      );
    } catch (error) {
      this.logger.warn('명령 메뉴를 등록하지 못했습니다. 명령 자체는 정상 동작합니다.');
      this.logger.error('setMyCommands 실패', error);
    }

    if (this.sync.getState() !== 'no-remote') {
      this.pushScheduler.startPeriodic();
    }

    await this.gateway.start(this.router);
    this.logger.info('storygram이 폴링을 시작했습니다.');
  }

  public async stop(): Promise<void> {
    this.pushScheduler.stop();
    await this.gateway.stop();
  }


  private buildContext(update: IncomingUpdate): ChatContext {
    return new ChatContext(update, this.gateway, this.content, this.store, this.sync);
  }
}
