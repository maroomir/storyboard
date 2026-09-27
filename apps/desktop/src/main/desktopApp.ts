import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { ConfigFileError, StoryboardHomePaths } from '@storyboard/story-config';

import type { AppBootstrap, UiLanguage, WorkspaceOverview } from '@/shared/dto';
import { resolveUiLanguage, translate, type MessageKey, type MessageParams } from '@/shared/i18n/translate';
import type { DesktopEventName, DesktopEvents, WorkspaceCreateRequest } from '@/shared/ipcContract';

import { DesktopLogger } from './desktopLogger';
import { DesktopStateStore } from './desktopState';
import { fail, succeed, type ServiceFailure, type ServiceResult } from './serviceResult';
import { createHomeSettingsStores, SettingsService, type SettingsStores } from './settingsService';
import { WorkspaceSession, workspaceFolderName } from './workspaceSession';

// Everything the app needs from Electron, handed in so the rest of main runs (and is tested)
// without it.
export interface DesktopAppPorts {
  readonly homePaths: StoryboardHomePaths;
  readonly logFile: string;
  readonly version: string;
  readonly systemLocale: string;
  readonly documentsDirectory: string;
  readonly chooseDirectory: (title: string, defaultPath?: string) => Promise<string | undefined>;
  readonly emit: <E extends DesktopEventName>(event: E, payload: DesktopEvents[E]) => void;
  // A non-blocking notice for problems the author should know about but that stop nothing.
  readonly notify: (message: string) => void;
  // Restarts into a downloaded update. Only a packaged app ever has one.
  readonly installUpdate: () => void;
}

export class DesktopApp {
  public readonly logger: DesktopLogger;
  public readonly settings: SettingsService;
  private readonly state: DesktopStateStore;
  private readonly homeStores: SettingsStores;
  private readonly offeredParentDirectories = new Set<string>();
  private readonly reportedConfigFiles = new Set<string>();
  private current: WorkspaceSession | undefined;

  public constructor(private readonly ports: DesktopAppPorts) {
    this.logger = new DesktopLogger(ports.logFile);
    this.state = new DesktopStateStore(join(ports.homePaths.home, 'desktop.json'), (backupFile) =>
      ports.notify(this.t('dialog.discardedState', { file: backupFile })),
    );
    this.homeStores = createHomeSettingsStores(ports.homePaths, (error) => this.reportInvalidConfig(error));
    this.settings = new SettingsService({
      stores: () => this.current?.container ?? this.homeStores,
      hasOpenWorkspace: () => this.current !== undefined,
      language: () => this.language,
      translate: (key, params) => this.t(key, params),
    });
  }

  public get language(): UiLanguage {
    return this.state.language ?? resolveUiLanguage(this.ports.systemLocale);
  }

  public get session(): WorkspaceSession | undefined {
    return this.current;
  }

  public t(key: MessageKey, params?: MessageParams): string {
    return translate(this.language, key, params);
  }

  public bootstrap(): AppBootstrap {
    return {
      version: this.ports.version,
      language: this.language,
      recentWorkspaces: this.state.recentWorkspaces,
      isProviderReady: this.settings.isProviderReady(),
      defaultParentDirectory: this.defaultParentDirectory(),
    };
  }

  public async installUpdate(): Promise<Record<string, never>> {
    await this.shutdown('finish-scene');
    this.ports.installUpdate();
    return {};
  }

  public setLanguage(language: UiLanguage): { readonly language: UiLanguage } {
    this.state.setLanguage(language);
    return { language };
  }

  public requireSession(): ServiceResult<WorkspaceSession> {
    return this.current === undefined ? fail('no-workspace', this.t('error.noWorkspace')) : succeed(this.current);
  }

  public async openWorkspace(recentPath: string | undefined): Promise<ServiceResult<WorkspaceOverview | { readonly cancelled: true }>> {
    // SECURITY: 렌더러가 보낸 경로는 main 이 최근 목록에 적어 둔 것일 때만 연다. 다른 경로는 반드시
    // main 의 폴더 대화상자를 거친다.
    if (recentPath !== undefined && !this.state.isRecentWorkspace(recentPath)) {
      return fail('invalid-request', this.t('error.invalidRequest'));
    }

    const path = recentPath ?? (await this.ports.chooseDirectory(this.t('dialog.openWorkspace')));

    if (path === undefined) {
      return succeed({ cancelled: true });
    }

    if (recentPath !== undefined && !existsSync(path)) {
      this.state.forgetWorkspace(path);
      return fail('not-found', this.t('error.recentMissing', { path }));
    }

    return await this.activate(() => WorkspaceSession.open(this.sessionOptions(path)));
  }

  public async chooseParentDirectory(): Promise<{ readonly directory?: string }> {
    const directory = await this.ports.chooseDirectory(this.t('dialog.chooseParent'), this.defaultParentDirectory());

    if (directory !== undefined) {
      this.offeredParentDirectories.add(resolve(directory));
    }

    return directory === undefined ? {} : { directory };
  }

  public async createWorkspace(
    parentDirectory: string,
    request: WorkspaceCreateRequest,
  ): Promise<ServiceResult<WorkspaceOverview>> {
    const parent = resolve(parentDirectory);

    // SECURITY: 새 작품은 main 이 권한 기본 위치이거나 대화상자로 고르게 한 폴더 안에만 만든다.
    if (parent !== resolve(this.defaultParentDirectory()) && !this.offeredParentDirectories.has(parent)) {
      return fail('invalid-request', this.t('error.invalidRequest'));
    }

    const path = join(parent, workspaceFolderName(request.title));
    return await this.activate(() => WorkspaceSession.create({ ...this.sessionOptions(path), request }));
  }

  public async closeWorkspace(): Promise<ServiceResult<Record<string, never>>> {
    if (this.current === undefined) {
      return succeed({});
    }

    const closed = await this.current.close();

    if (closed.ok) {
      this.current = undefined;
    }

    return closed;
  }

  // Quitting mid-run either lets the scene in progress finish (and pauses there) or leaves at once;
  // both resume on the next open.
  public async shutdown(mode: 'finish-scene' | 'now'): Promise<void> {
    const session = this.current;

    if (session === undefined) {
      return;
    }

    if (session.runs.isBusy && mode === 'finish-scene') {
      session.runs.pause();
      await session.runs.waitUntilIdle();
    }

    if (!session.runs.isBusy) {
      await session.close();
    }

    this.current = undefined;
  }

  public busyRefusal(): Promise<ServiceFailure | undefined> {
    return this.current?.refuseWhileBusy() ?? Promise.resolve(undefined);
  }

  private async activate(
    openSession: () => Promise<ServiceResult<WorkspaceSession>>,
  ): Promise<ServiceResult<WorkspaceOverview>> {
    const closed = await this.closeWorkspace();

    if (!closed.ok) {
      return closed;
    }

    const opened = await openSession();

    if (!opened.ok) {
      return opened;
    }

    this.current = opened.data;
    const overview = await opened.data.overview();
    this.state.rememberWorkspace(opened.data.path, overview.title);
    this.ports.emit('run.changed', opened.data.runs.snapshot());

    return succeed(overview);
  }

  private sessionOptions(workspacePath: string): Parameters<typeof WorkspaceSession.open>[0] {
    return {
      workspacePath,
      homePaths: this.ports.homePaths,
      logger: this.logger,
      version: this.ports.version,
      translate: (key, params) => this.t(key, params),
      onInvalidConfigFile: (error) => this.reportInvalidConfig(error),
      onRunChanged: (snapshot) => this.ports.emit('run.changed', snapshot),
      onWorkspaceChanged: (change) => this.ports.emit('workspace.changed', change),
    };
  }

  private defaultParentDirectory(): string {
    return join(this.ports.documentsDirectory, 'Storyboard');
  }

  // A broken settings file keeps the app running on defaults, but the author is told once which
  // file it is — never a silent fallback.
  private reportInvalidConfig(error: ConfigFileError): void {
    this.logger.warn(error.message);

    if (!this.reportedConfigFiles.has(error.file)) {
      this.reportedConfigFiles.add(error.file);
      this.ports.notify(this.t('dialog.invalidConfig', { file: error.file, message: error.message }));
    }
  }
}
