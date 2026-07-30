import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  GitClient,
  PushScheduler,
  SyncService,
  inspectWorkspaceRepository,
} from '@storyboard/story-git';

import { aiTaskCatalog } from '@storyboard/story-ai';

import { createAiEngine } from '../ai/aiGateway';
import { createJobAwareCliRunner } from '../provider/abortableCliRunner';
import { getActiveJobId } from '../provider/jobSignalContext';
import { createWorkerRemoteSyncExecutor } from '../sync/workerExecutor';

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
import { createDoctorHandler } from '../chat/handlers/doctor';
import { createRenameHandler, createSetHandler } from '../chat/handlers/edit';
import {
  createDraftCommandHandler,
  createJobsHandler,
  createManuscriptCommandHandler,
  createOutlineCommandHandler,
  createPlanCommandHandler,
  createStopHandler,
} from '../chat/handlers/generate';
import type { IncomingUpdate } from '../chat/ports';
import { CommandRegistry } from '../chat/registry';
import { UpdateRouter } from '../chat/router';
import type { StorygramConfig } from '../config/config';
import { ContentService } from '../content/contentService';
import { startDashboardServer, type DashboardHandle } from '../dashboard/server';
import { createGenJobs, type GenJobs } from './createGenJobs';
import { SceneDraftGenerator } from '../gen/sceneDraftGenerator';
import { openDatabase, type StorygramDatabase } from '../store/db';
import { TelegramGateway } from '../telegram/gateway';
import { createAllowlist } from '../telegram/allowlist';
import type { Logger } from '../util/logger';
import { MutateGate, createGitTrackedPathPredicate } from '../workspace/mutateGate';
import { WorkspaceStore } from '../workspace/workspaceStore';

export interface StorygramApplicationOptions {
  readonly config: StorygramConfig;
  readonly logger: Logger;
  readonly stateDbPath: string;
  readonly configFilePath: string;
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
  private readonly db: StorygramDatabase;
  private readonly genJobs: GenJobs;
  private dashboard: DashboardHandle | undefined;

  public constructor(private readonly options: StorygramApplicationOptions) {
    const { config, logger } = options;
    this.logger = logger;

    this.store = new WorkspaceStore(config.workspace.path);
    this.git = new GitClient(config.workspace.path);
    // NOTE: the bundled worker sits next to the bundled entry (dist/syncWorker.js); network git
    // calls run there so the polling loop never stalls (decision #30).
    this.sync = new SyncService(
      this.git,
      {
        remote: config.workspace.remote,
        executeRemoteSync: createWorkerRemoteSyncExecutor(join(__dirname, 'syncWorker.js')),
      },
      logger,
    );
    this.pushScheduler = new PushScheduler(
      config.workspace.pushDebounceSec * 1000,
      config.workspace.syncIntervalSec * 1000,
      () => {
        void this.sync.syncNow().catch((error) => logger.error('주기 동기화 실패', error));
      },
    );
    this.sync.setPushRequest(() => this.pushScheduler.requestPush());

    const gate = new MutateGate(this.store, this.git, this.sync, logger, {
      isTrackedPath: createGitTrackedPathPredicate(this.git),
    });
    this.content = new ContentService(this.store, gate);

    this.gateway = new TelegramGateway({
      botToken: config.telegram.botToken,
      allowlist: createAllowlist(config.telegram),
      logger,
    });

    mkdirSync(dirname(options.stateDbPath), { recursive: true });
    this.db = openDatabase(options.stateDbPath);
    const { service: aiService, registry } = createAiEngine({
      providers: config.providers,
      cliRunner: createJobAwareCliRunner(),
      // Every AI call made while a job runs lands in that job's ledger row; `this.genJobs` is
      // assigned below, but usage callbacks only fire once jobs execute.
      onUsage: (record) => {
        const jobId = getActiveJobId();
        if (jobId === undefined) {
          return;
        }
        this.genJobs.manager.recordUsage({
          jobId,
          taskName: record.taskName,
          providerId: record.providerId,
          inputTokens: record.usage?.inputTokens ?? 0,
          outputTokens: record.usage?.outputTokens ?? 0,
          costUsd: record.costUsd,
        });
      },
    });
    this.genJobs = createGenJobs({
      db: this.db,
      store: this.store,
      content: this.content,
      aiService,
      draftGenerator: new SceneDraftGenerator({
        store: this.store,
        content: this.content,
        aiService,
        registry,
        draftConfig: config.draft,
      }),
      sender: this.gateway,
      jobsConfig: config.jobs,
      logger,
      notifyInterrupted: (jobs) => {
        for (const job of jobs) {
          const text = `⚠️ 봇이 재시작되어 작업 #${job.id} (${job.kind})이 중단되었습니다. 필요하면 명령을 다시 실행해주세요.`;
          // Editing the stale progress message also retires its ⏳ text and Stop button; jobs
          // interrupted before a progress message existed fall back to a fresh message.
          const deliver = job.progressMessageId
            ? this.gateway.editMessage(
                { chatId: job.chatId, messageId: job.progressMessageId },
                { text },
              )
            : this.gateway.sendMessage(job.chatId, { text });
          void deliver.catch((error) => logger.error('중단 알림 전송 실패', error));
        }
      },
    });

    for (const handler of [
      createStartHandler(),
      createStatusHandler(),
      createCardsHandler(),
      createShowHandler(),
      createScenesHandler(),
      createBibleHandler(),
      createSyncHandler(),
      createDoctorHandler({
        configFile: options.configFilePath,
        providers: config.providers,
        remote: config.workspace.remote,
      }),
      createRenameHandler(),
      createSetHandler(),
      createDraftCommandHandler(),
      createOutlineCommandHandler(),
      createPlanCommandHandler(),
      createManuscriptCommandHandler(),
      createJobsHandler(),
      createStopHandler(),
    ]) {
      this.registry.register(handler);
    }

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

    // A mistyped task name in providers.tasks would silently never apply; name the ones we do
    // not recognize so the operator can fix the key.
    const knownTasks = new Set(aiTaskCatalog.map((entry) => entry.name));
    for (const taskName of Object.keys(this.options.config.providers?.tasks ?? {})) {
      if (!knownTasks.has(taskName as never)) {
        this.logger.warn(`알 수 없는 태스크 이름을 무시합니다: providers.tasks.${taskName}`);
      }
    }

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

    this.genJobs.start();

    if (this.options.config.dashboard.enabled) {
      try {
        this.dashboard = await startDashboardServer(this.options.config.dashboard.port, {
          store: this.store,
          content: this.content,
          sync: this.sync,
          jobs: this.genJobs.manager,
          logger: this.logger,
        });
        this.logger.info(`대시보드: http://127.0.0.1:${this.dashboard.port}/`);
      } catch (error) {
        // The panel is a convenience; a port clash must not stop the bot.
        this.logger.warn('대시보드를 시작하지 못했습니다. 봇은 계속 동작합니다.');
        this.logger.error('dashboard bind 실패', error);
      }
    }

    await this.gateway.start(this.router);
    this.logger.info('storygram이 폴링을 시작했습니다.');
  }

  public async stop(): Promise<void> {
    this.pushScheduler.stop();
    await this.genJobs.stop();
    await this.dashboard?.stop();
    await this.gateway.stop();
    this.db.close();
  }

  private buildContext(update: IncomingUpdate): ChatContext {
    return new ChatContext(
      update,
      this.gateway,
      this.content,
      this.store,
      this.sync,
      this.genJobs.manager,
    );
  }
}
