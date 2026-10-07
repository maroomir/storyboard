import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  buildCompositionPreset,
  createWorkspace,
  readProjectJson,
  readWorkspaceRunLock,
} from '@storyboard/story-engine';
import {
  describeWorkspaceRunLockHolder,
  getStoryboardProjectPaths,
  scenePath,
  NodeUri,
  STORYBOARD_RELATIVE_PATHS,
  readSceneFile,
  type ProjectSetting,
} from '@storyboard/story-model';
import type { ConfigFileError, StoryboardHomePaths } from '@storyboard/story-config';
import { NodeFileSystem } from '@storyboard/story-node';

import type {
  DraftDocument,
  RunSnapshot,
  SceneNotes,
  WorkspaceOverview,
} from '@/shared/dto';
import type { MessageKey, MessageParams } from '@/shared/i18n/translate';
import type { DesktopErrorCode, WorkspaceCreateRequest } from '@/shared/ipcContract';

import { BibleService } from './bibleService';
import { createDesktopContainer, type DesktopContainer } from './desktopContainer';
import type { DesktopLogger } from './desktopLogger';
import { RunController } from './runController';
import { fail, succeed, type ServiceFailure, type ServiceResult } from './serviceResult';
import { locateSnapshotRepository, SnapshotService } from './snapshotService';
import { watchWorkspace, type WorkspaceChange } from './workspaceWatcher';
import { readDraftDocument, readSceneNotes, readWorkspaceOverview } from './workspaceReader';

export interface WorkspaceSessionOptions {
  readonly workspacePath: string;
  readonly homePaths: StoryboardHomePaths;
  readonly logger: DesktopLogger;
  readonly version: string;
  readonly translate: (key: MessageKey, params?: MessageParams) => string;
  readonly onInvalidConfigFile: (error: ConfigFileError) => void;
  readonly onRunChanged: (snapshot: RunSnapshot) => void;
  readonly onWorkspaceChanged: (change: WorkspaceChange) => void;
}

// NOTE: 폴더 이름으로 쓸 수 없는 글자만 바꾼다. 한글 제목은 그대로 둔다 — 작가가 파인더·탐색기에서
// 자기 작품을 제목으로 알아봐야 한다.
export function workspaceFolderName(title: string): string {
  const cleaned = [...title]
    .map((character) => (character.charCodeAt(0) < 0x20 || '\\/:*?"<>|'.includes(character) ? ' ' : character))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '');

  return cleaned.length > 0 ? cleaned.slice(0, 80) : 'storyboard-work';
}

export function contractSettingFrom(request: WorkspaceCreateRequest): {
  readonly setting: ProjectSetting;
  readonly preset: ReturnType<typeof buildCompositionPreset>;
} {
  const preset = buildCompositionPreset({ composition: request.composition, pov: request.pov });

  return {
    preset,
    setting: {
      genre: request.genre,
      audience: request.audience,
      pov: request.pov,
      targetWordCount: request.targetWordCount,
      chapterCount: request.chapterCount,
      scenesPerChapter: request.scenesPerChapter,
      concept: request.concept,
      tags: [],
      prohibitions: [],
      styleConstraints: [],
      qualityCriteria: [],
      ...preset.setting,
    },
  };
}

const sceneRenameErrorCodes = {
  'invalid-stem': 'invalid-request',
  missing: 'not-found',
  'order-taken': 'already-exists',
  failed: 'failed',
} as const satisfies Record<string, DesktopErrorCode>;

// One open work: its engine container, its version history, its run, and the author's editing
// sessions. Closing it ends every session and records a last snapshot.
export class WorkspaceSession {
  private readonly editedStems = new Set<string>();
  private readonly archivedStems = new Set<string>();
  private readonly watcher: { readonly dispose: () => void };

  private constructor(
    private readonly options: WorkspaceSessionOptions,
    public readonly container: DesktopContainer,
    public readonly snapshots: SnapshotService,
    public readonly runs: RunController,
    public readonly bible: BibleService,
  ) {
    this.watcher = watchWorkspace(container.workspaceRoot.fsPath, options.onWorkspaceChanged);
  }

  public static isWorkspace(path: string): boolean {
    return existsSync(join(path, STORYBOARD_RELATIVE_PATHS.projectJson));
  }

  public static async open(options: WorkspaceSessionOptions): Promise<ServiceResult<WorkspaceSession>> {
    if (!WorkspaceSession.isWorkspace(options.workspacePath)) {
      return fail('not-a-workspace', options.translate('error.notAWorkspace', { path: options.workspacePath }));
    }

    const container = createDesktopContainer({
      workspacePath: options.workspacePath,
      homePaths: options.homePaths,
      logger: options.logger,
      version: options.version,
      onInvalidConfigFile: options.onInvalidConfigFile,
    });
    const resources = await container.loadResourceOverrides();
    for (const problem of resources.problems) {
      options.logger.warn(problem.message);
    }
    const snapshots = new SnapshotService(await locateSnapshotRepository(options.workspacePath));
    const takeSnapshot = async (message: string): Promise<void> => {
      // NOTE: 버전 기록이 실패해도 작가의 글은 이미 디스크에 있다. 기록 실패로 작업을 막지 않는다.
      try {
        await snapshots.snapshot(message);
      } catch (error) {
        options.logger.error('Snapshot failed', error);
      }
    };
    const runs = new RunController({
      container,
      translate: options.translate,
      snapshot: takeSnapshot,
      onChange: options.onRunChanged,
    });
    const bible = new BibleService(container.fileSystem, container.workspaceRoot, (message) =>
      options.translate('error.invalidCard', { message }),
    );
    const session = new WorkspaceSession(options, container, snapshots, runs, bible);

    // Whatever changed while the work was closed (the CLI, the extension, a text editor) becomes its
    // own version, so a later restore can tell the app's changes from those.
    await takeSnapshot(options.translate('snapshot.opened'));
    await runs.refresh();

    return succeed(session);
  }

  public static async create(
    options: WorkspaceSessionOptions & { readonly request: WorkspaceCreateRequest },
  ): Promise<ServiceResult<WorkspaceSession>> {
    if (existsSync(options.workspacePath)) {
      return fail('already-exists', options.translate('error.alreadyExists', { path: options.workspacePath }));
    }

    await mkdir(options.workspacePath, { recursive: true });

    const { setting, preset } = contractSettingFrom(options.request);
    await createWorkspace({
      fileSystem: new NodeFileSystem(),
      workspaceRoot: NodeUri.file(options.workspacePath),
      name: options.request.title,
      setting,
      narratorCards: preset.narratorCards,
    });

    const snapshots = new SnapshotService(await locateSnapshotRepository(options.workspacePath));
    await snapshots.snapshot(options.translate('snapshot.workspaceCreated', { title: options.request.title }));

    return await WorkspaceSession.open(options);
  }

  public get path(): string {
    return this.container.workspaceRoot.fsPath;
  }

  public async title(): Promise<string> {
    const paths = getStoryboardProjectPaths(this.container.workspaceRoot);
    return (await readProjectJson(this.container.fileSystem, paths.projectJson)).name;
  }

  public async overview(): Promise<WorkspaceOverview> {
    return await readWorkspaceOverview(
      this.container,
      this.runs.generatingSceneStem,
      await this.foreignLockMessage(),
    );
  }

  public async notes(stem: string): Promise<SceneNotes> {
    return await readSceneNotes(this.container, stem);
  }

  public async readDraft(stem: string): Promise<DraftDocument> {
    return await readDraftDocument(this.container, stem);
  }

  // The first save of a session keeps the pre-edit version in `.draft/`; the session's snapshot is
  // taken when it ends. An AI edit is its own step, snapshotted at once; its `.draft/` copy follows
  // the history setting like a regeneration's does.
  public async saveDraft(
    stem: string,
    body: string,
    reason: 'autosave' | 'ai-edit',
  ): Promise<ServiceResult<{ readonly kind: 'saved' | 'unchanged' }>> {
    const refusal = await this.refuseWhileBusy();

    if (refusal !== undefined) {
      return refusal;
    }

    const archivePrevious =
      reason === 'ai-edit'
        ? this.container.configBridge.isKeepDraftHistoryEnabled()
        : !this.archivedStems.has(stem);
    const result = await this.container.drafts.saveEdit({
      workspaceRoot: this.container.workspaceRoot,
      sceneStem: stem,
      body,
      archivePrevious,
    });

    if (!result.ok) {
      return fail('not-found', this.options.translate('error.draftMissing'));
    }

    if (result.kind === 'unchanged') {
      return succeed({ kind: 'unchanged' });
    }

    if (reason === 'ai-edit') {
      await this.snapshot('snapshot.aiEdit', { title: await this.sceneTitle(stem) });
    } else {
      this.archivedStems.add(stem);
      this.editedStems.add(stem);
    }

    return succeed({ kind: 'saved' });
  }

  public async endDraftSession(stem: string): Promise<void> {
    this.archivedStems.delete(stem);

    if (this.editedStems.delete(stem)) {
      await this.snapshot('snapshot.handEdit', { title: await this.sceneTitle(stem) });
    }
  }

  // A run is about to rewrite drafts, or the history is about to change under the editor: every open
  // editing session is closed first so its edits become their own version.
  public async endAllDraftSessions(): Promise<void> {
    for (const stem of [...this.editedStems, ...this.archivedStems]) {
      await this.endDraftSession(stem);
    }
  }

  // The engine moves everything keyed by the stem and refuses a number another scene holds; its
  // message is shown as it is. The open editing session ends first so its edits are their own version.
  public async renameScene(from: string, to: string): Promise<ServiceResult<{ readonly stem: string }>> {
    await this.endDraftSession(from);

    const title = await this.sceneTitle(from);
    const result = await this.container.drafts.renameScene({
      workspaceRoot: this.container.workspaceRoot,
      fromStem: from,
      toStem: to,
    });

    if (!result.ok) {
      return fail(sceneRenameErrorCodes[result.kind], result.message);
    }

    await this.snapshot('snapshot.sceneRenamed', { title, from: result.fromStem, to: result.toStem });
    return succeed({ stem: result.toStem });
  }

  public async sceneExists(stem: string): Promise<boolean> {
    return await this.container.fileSystem.exists(scenePath(this.container.workspaceRoot, stem));
  }

  public async proposeEdit(
    stem: string,
    selectedText: string,
    instruction: string,
  ): Promise<ServiceResult<{ readonly text: string }>> {
    const { container } = this;
    const { translate } = this.options;

    if (!container.configBridge.isDefaultProviderConfigured()) {
      return fail('provider-missing', translate('error.providerMissing'));
    }

    const result = await container.drafts.prepareAugmentation({
      draftSceneStem: stem,
      sceneUri: scenePath(container.workspaceRoot, stem),
      scope: 'selection',
      target: selectedText,
      workspaceRoot: container.workspaceRoot,
      instruction,
    });

    if (result.ok) {
      return succeed({ text: result.text });
    }

    return result.kind === 'empty'
      ? fail('failed', translate('error.emptyProposal'))
      : fail('failed', result.message);
  }

  // Edits are refused while any run holds the work: ours rewrites drafts under the editor, and
  // another app's lock means the same thing from outside.
  public async refuseWhileBusy(): Promise<ServiceFailure | undefined> {
    if (this.runs.isBusy || (await this.foreignLockMessage()) !== undefined) {
      return fail('workspace-locked', this.options.translate('error.readOnly'));
    }

    return undefined;
  }

  public async snapshot(key: MessageKey, params?: MessageParams): Promise<void> {
    try {
      await this.snapshots.snapshot(this.options.translate(key, params));
    } catch (error) {
      this.options.logger.error('Snapshot failed', error);
    }
  }

  public async close(): Promise<ServiceResult<Record<string, never>>> {
    if (this.runs.isBusy) {
      return fail('run-active', this.options.translate('error.runActive'));
    }

    await this.endAllDraftSessions();
    await this.snapshot('snapshot.closed');
    this.watcher.dispose();
    this.container.postGenerationUpdates.dispose();

    return succeed({});
  }

  private async foreignLockMessage(): Promise<string | undefined> {
    const holder = await readWorkspaceRunLock({
      fileSystem: this.container.fileSystem,
      workspaceRoot: this.container.workspaceRoot,
    });

    return holder === undefined || holder.token === this.runs.activeLockToken
      ? undefined
      : describeWorkspaceRunLockHolder(holder);
  }

  private async sceneTitle(stem: string): Promise<string> {
    try {
      const scene = await readSceneFile(
        scenePath(this.container.workspaceRoot, stem),
        this.container.fileSystem,
        `${stem}.card`,
      );
      return scene.card.title ?? scene.slug;
    } catch {
      return stem;
    }
  }
}
