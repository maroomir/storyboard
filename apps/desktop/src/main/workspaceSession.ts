import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  buildCompositionPreset,
  readWorkspaceRunLock,
  type AugmentDraftResult,
  type CompositionPreset,
  type RenameSceneResult,
  type SaveDraftEditResult,
  WorkspaceInitializer,
} from '@storyboard/story-engine';
import {
  describeWorkspaceRunLockHolder,
  scenePath,
  NodeUri,
  STORYBOARD_RELATIVE_PATHS,
  readSceneFile,
  type ProjectSetting,
  type WorkspaceRunLockRecord,
  type SceneFile,
} from '@storyboard/story-model';
import type { ConfigFileError, StoryboardHomePaths } from '@storyboard/story-config';
import { NodeFileSystem } from '@storyboard/story-node';

import type { DraftDocument, RunSnapshot, SceneNotes, WorkspaceOverview } from '@/shared/dto';
import type { MessageKey, MessageParams } from '@/shared/i18n/translate';
import type { DesktopErrorCode, WorkspaceCreateRequest } from '@/shared/ipcContract';

import { BibleService } from '@/main/bibleService';
import { NotesService } from '@/main/notesService';
import { createDesktopContainer, type DesktopContainer } from '@/main/desktopContainer';
import type { DesktopLogger } from '@/main/desktopLogger';
import { RunController } from '@/main/runController';
import { fail, succeed, type ServiceFailure, type ServiceResult } from '@/main/serviceResult';
import { locateSnapshotRepository, SnapshotService } from '@/main/snapshotService';
import { watchWorkspace, type WorkspaceChange } from '@/main/workspaceWatcher';
import { WorkspaceReader } from '@/main/workspaceReader';
import type { ResourceOverrideReport } from '@storyboard/story-app';

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

export function workspaceFolderName(title: string): string {
  const cleaned: string = [...title]
    .map((character) =>
      character.charCodeAt(0) < 0x20 || '\\/:*?"<>|'.includes(character) ? ' ' : character,
    )
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
  const preset: CompositionPreset = buildCompositionPreset({
    composition: request.composition,
    pov: request.pov,
  });

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

export class WorkspaceSession {
  private readonly editedStems: Set<string> = new Set<string>();
  private readonly archivedStems: Set<string> = new Set<string>();
  private readonly watcher: { readonly dispose: () => void };

  private constructor(
    private readonly options: WorkspaceSessionOptions,
    public readonly container: DesktopContainer,
    public readonly snapshots: SnapshotService,
    public readonly runs: RunController,
    public readonly bible: BibleService,
    public readonly notesImport: NotesService,
  ) {
    this.watcher = watchWorkspace(container.workspaceRoot.fsPath, options.onWorkspaceChanged);
  }

  public static isWorkspace(path: string): boolean {
    return existsSync(join(path, STORYBOARD_RELATIVE_PATHS.projectJson));
  }

  public static async open(
    options: WorkspaceSessionOptions,
  ): Promise<ServiceResult<WorkspaceSession>> {
    if (!WorkspaceSession.isWorkspace(options.workspacePath)) {
      return fail(
        'not-a-workspace',
        options.translate('error.notAWorkspace', { path: options.workspacePath }),
      );
    }

    const container: DesktopContainer = createDesktopContainer({
      workspacePath: options.workspacePath,
      homePaths: options.homePaths,
      logger: options.logger,
      version: options.version,
      onInvalidConfigFile: options.onInvalidConfigFile,
    });
    const resources: ResourceOverrideReport = await container.loadResourceOverrides();
    for (const problem of resources.problems) {
      options.logger.warn(problem.message);
    }
    const snapshots: SnapshotService = new SnapshotService(
      await locateSnapshotRepository(options.workspacePath),
    );
    const takeSnapshot = async (message: string): Promise<void> => {
      try {
        await snapshots.snapshot(message);
      } catch (error) {
        options.logger.error('Snapshot failed', error);
      }
    };
    const runs: RunController = new RunController({
      container,
      translate: options.translate,
      snapshot: takeSnapshot,
      onChange: options.onRunChanged,
    });
    const bible: BibleService = new BibleService(
      container.fileSystem,
      container.workspaceRoot,
      (message) => options.translate('error.invalidCard', { message }),
    );
    const session: WorkspaceSession = new WorkspaceSession(
      options,
      container,
      snapshots,
      runs,
      bible,
      new NotesService(container, options.translate),
    );

    await takeSnapshot(options.translate('snapshot.opened'));
    await runs.refresh();

    return succeed(session);
  }

  public static async create(
    options: WorkspaceSessionOptions & { readonly request: WorkspaceCreateRequest },
  ): Promise<ServiceResult<WorkspaceSession>> {
    if (existsSync(options.workspacePath)) {
      return fail(
        'already-exists',
        options.translate('error.alreadyExists', { path: options.workspacePath }),
      );
    }

    await mkdir(options.workspacePath, { recursive: true });

    const { setting, preset } = contractSettingFrom(options.request);
    await new WorkspaceInitializer(new NodeFileSystem()).createWorkspace({
      workspaceRoot: NodeUri.file(options.workspacePath),
      name: options.request.title,
      setting,
      narratorCards: preset.narratorCards,
    });

    const snapshots: SnapshotService = new SnapshotService(
      await locateSnapshotRepository(options.workspacePath),
    );
    await snapshots.snapshot(
      options.translate('snapshot.workspaceCreated', { title: options.request.title }),
    );

    return await WorkspaceSession.open(options);
  }

  public get path(): string {
    return this.container.workspaceRoot.fsPath;
  }

  public async title(): Promise<string> {
    return (await this.container.project.read(this.container.workspaceRoot)).name;
  }

  public async overview(): Promise<WorkspaceOverview> {
    return await new WorkspaceReader(this.container).readOverview(
      this.runs.generatingSceneStem,
      await this.foreignLockMessage(),
    );
  }

  public async notes(stem: string): Promise<SceneNotes> {
    return await new WorkspaceReader(this.container).readSceneNotes(stem);
  }

  public async readDraft(stem: string): Promise<DraftDocument> {
    return await new WorkspaceReader(this.container).readDraftDocument(stem);
  }

  public async saveDraft(
    stem: string,
    body: string,
    reason: 'autosave' | 'ai-edit',
  ): Promise<ServiceResult<{ readonly kind: 'saved' | 'unchanged' }>> {
    const refusal: ServiceFailure | undefined = await this.refuseWhileBusy();

    if (refusal !== undefined) {
      return refusal;
    }

    const archivePrevious: boolean =
      reason === 'ai-edit'
        ? this.container.configBridge.isKeepDraftHistoryEnabled()
        : !this.archivedStems.has(stem);
    const savedEdit: SaveDraftEditResult = await this.container.drafts.saveEdit({
      workspaceRoot: this.container.workspaceRoot,
      sceneStem: stem,
      body,
      archivePrevious,
    });

    if (!savedEdit.ok) {
      return fail('not-found', this.options.translate('error.draftMissing'));
    }

    if (savedEdit.kind === 'unchanged') {
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

  public async endAllDraftSessions(): Promise<void> {
    for (const stem of [...this.editedStems, ...this.archivedStems]) {
      await this.endDraftSession(stem);
    }
  }

  public async renameScene(
    from: string,
    to: string,
  ): Promise<ServiceResult<{ readonly stem: string }>> {
    await this.endDraftSession(from);

    const title: string = await this.sceneTitle(from);
    const sceneRename: RenameSceneResult = await this.container.drafts.renameScene({
      workspaceRoot: this.container.workspaceRoot,
      fromStem: from,
      toStem: to,
    });

    if (!sceneRename.ok) {
      return fail(sceneRenameErrorCodes[sceneRename.kind], sceneRename.message);
    }

    await this.snapshot('snapshot.sceneRenamed', {
      title,
      from: sceneRename.fromStem,
      to: sceneRename.toStem,
    });
    return succeed({ stem: sceneRename.toStem });
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

    const augmentation: AugmentDraftResult = await container.drafts.prepareAugmentation({
      draftSceneStem: stem,
      sceneUri: scenePath(container.workspaceRoot, stem),
      scope: 'selection',
      target: selectedText,
      workspaceRoot: container.workspaceRoot,
      instruction,
    });

    if (augmentation.ok) {
      return succeed({ text: augmentation.text });
    }

    return augmentation.kind === 'empty'
      ? fail('failed', translate('error.emptyProposal'))
      : fail('failed', augmentation.message);
  }

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
    const holder: WorkspaceRunLockRecord | undefined = await readWorkspaceRunLock({
      fileSystem: this.container.fileSystem,
      workspaceRoot: this.container.workspaceRoot,
    });

    return holder === undefined || holder.token === this.runs.activeLockToken
      ? undefined
      : describeWorkspaceRunLockHolder(holder);
  }

  private async sceneTitle(stem: string): Promise<string> {
    try {
      const scene: SceneFile = await readSceneFile(
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
