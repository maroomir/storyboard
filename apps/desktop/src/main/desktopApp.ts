import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { requestHiddenProviderConsent } from '@storyboard/story-ai';
import type { ConfigFileError, StoryboardHomePaths } from '@storyboard/story-config';

import type { AppBootstrap, UiLanguage, WorkspaceOverview } from '@/shared/dto';
import { resolveUiLanguage, translate, type MessageKey, type MessageParams } from '@/shared/i18n/translate';
import type { DesktopEventName, DesktopEvents, WorkspaceCreateRequest } from '@/shared/ipcContract';

import { DesktopLogger } from '@/main/desktopLogger';
import { DesktopStateStore } from '@/main/desktopState';
import { fail, succeed, type ServiceFailure, type ServiceResult } from '@/main/serviceResult';
import { createHomeSettingsStores, SettingsService, type SettingsStores } from '@/main/settingsService';
import { WorkspaceSession, workspaceFolderName } from '@/main/workspaceSession';

export interface DesktopAppPorts {
  readonly homePaths: StoryboardHomePaths;
  readonly logFile: string;
  readonly version: string;
  readonly systemLocale: string;
  readonly documentsDirectory: string;
  readonly chooseDirectory: (title: string, defaultPath?: string) => Promise<string | undefined>;
  readonly chooseFile: (title: string, extensions: readonly string[]) => Promise<string | undefined>;
  readonly emit: <E extends DesktopEventName>(event: E, payload: DesktopEvents[E]) => void;
  readonly notify: (message: string) => void;
  readonly confirm: (question: ConfirmQuestion) => Promise<boolean>;
  readonly installUpdate: () => void;
}

export interface ConfirmQuestion {
  readonly title: string;
  readonly detail: string;
  readonly acceptLabel: string;
  readonly declineLabel: string;
}

export class DesktopApp {
  public readonly logger: DesktopLogger;
  public readonly settings: SettingsService;
  private readonly state: DesktopStateStore;
  private readonly homeStores: SettingsStores;
  private readonly offeredParentDirectories: Set<string> = new Set<string>();
  private readonly offeredNoteLocations: Set<string> = new Set<string>();
  private readonly reportedConfigFiles: Set<string> = new Set<string>();
  private current: WorkspaceSession | undefined;

  public constructor(private readonly ports: DesktopAppPorts) {
    this.logger = new DesktopLogger(ports.logFile);
    this.state = new DesktopStateStore(join(ports.homePaths.home, 'desktop.json'), (backupFile) =>
      ports.notify(this.translate('dialog.discardedState', { file: backupFile })),
    );
    this.homeStores = createHomeSettingsStores(ports.homePaths, (error) => this.reportInvalidConfig(error));
    this.settings = new SettingsService({
      stores: (): SettingsStores => this.current?.container ?? this.homeStores,
      hasOpenWorkspace: (): boolean => this.current !== undefined,
      language: (): UiLanguage => this.language,
      translate: (key: MessageKey, params?: MessageParams): string => this.translate(key, params),
    });
  }

  public get language(): UiLanguage {
    return this.state.language ?? resolveUiLanguage(this.ports.systemLocale);
  }

  public get session(): WorkspaceSession | undefined {
    return this.current;
  }

  public translate(key: MessageKey, params?: MessageParams): string {
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
    return this.current === undefined ? fail('no-workspace', this.translate('error.noWorkspace')) : succeed(this.current);
  }

  public async openWorkspace(recentPath: string | undefined): Promise<ServiceResult<WorkspaceOverview | { readonly cancelled: true }>> {
    if (recentPath !== undefined && !this.state.isRecentWorkspace(recentPath)) {
      return fail('invalid-request', this.translate('error.invalidRequest'));
    }

    const path: string | undefined = recentPath ?? (await this.ports.chooseDirectory(this.translate('dialog.openWorkspace')));

    if (path === undefined) {
      return succeed({ cancelled: true });
    }

    if (recentPath !== undefined && !existsSync(path)) {
      this.state.forgetWorkspace(path);
      return fail('not-found', this.translate('error.recentMissing', { path }));
    }

    return await this.activate(() => WorkspaceSession.open(this.sessionOptions(path)));
  }

  public async chooseParentDirectory(): Promise<{ readonly directory?: string }> {
    const directory: string | undefined = await this.ports.chooseDirectory(this.translate('dialog.chooseParent'), this.defaultParentDirectory());

    if (directory !== undefined) {
      this.offeredParentDirectories.add(resolve(directory));
    }

    return directory === undefined ? {} : { directory };
  }

  public async chooseNotesLocation(kind: 'folder' | 'zip'): Promise<{ readonly path?: string }> {
    const path: string | undefined =
      kind === 'folder'
        ? await this.ports.chooseDirectory(this.translate('dialog.chooseNotesFolder'))
        : await this.ports.chooseFile(this.translate('dialog.chooseNotesZip'), ['zip']);

    if (path !== undefined) {
      this.offeredNoteLocations.add(resolve(path));
    }

    return path === undefined ? {} : { path };
  }

  public isOfferedNoteLocation(path: string): boolean {
    return this.offeredNoteLocations.has(resolve(path));
  }

  public async createWorkspace(
    parentDirectory: string,
    request: WorkspaceCreateRequest,
  ): Promise<ServiceResult<WorkspaceOverview>> {
    const parent: string = resolve(parentDirectory);

    if (parent !== resolve(this.defaultParentDirectory()) && !this.offeredParentDirectories.has(parent)) {
      return fail('invalid-request', this.translate('error.invalidRequest'));
    }

    const path: string = join(parent, workspaceFolderName(request.title));
    return await this.activate(() => WorkspaceSession.create({ ...this.sessionOptions(path), request }));
  }

  public async closeWorkspace(): Promise<ServiceResult<Record<string, never>>> {
    if (this.current === undefined) {
      return succeed({});
    }

    const closed: ServiceResult<Record<string, never>> = await this.current.close();

    if (closed.ok) {
      this.current = undefined;
    }

    return closed;
  }

  public async shutdown(mode: 'finish-scene' | 'now'): Promise<void> {
    const session: WorkspaceSession | undefined = this.current;

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
    const closed: ServiceResult<Record<string, never>> = await this.closeWorkspace();

    if (!closed.ok) {
      return closed;
    }

    const opened: ServiceResult<WorkspaceSession> = await openSession();

    if (!opened.ok) {
      return opened;
    }

    this.current = opened.data;
    await requestHiddenProviderConsent(opened.data.container.configBridge, (question) =>
      this.ports.confirm({ ...question, declineLabel: this.translate('common.cancel') }),
    );
    const overview: WorkspaceOverview = await opened.data.overview();
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
      translate: (key, params) => this.translate(key, params),
      onInvalidConfigFile: (error) => this.reportInvalidConfig(error),
      onRunChanged: (snapshot) => this.ports.emit('run.changed', snapshot),
      onWorkspaceChanged: (change) => this.ports.emit('workspace.changed', change),
    };
  }

  private defaultParentDirectory(): string {
    return join(this.ports.documentsDirectory, 'Storyboard');
  }

  private reportInvalidConfig(error: ConfigFileError): void {
    this.logger.warn(error.message);

    if (!this.reportedConfigFiles.has(error.file)) {
      this.reportedConfigFiles.add(error.file);
      this.ports.notify(this.translate('dialog.invalidConfig', { file: error.file, message: error.message }));
    }
  }
}
