import type { AiServices, HostAdapters, WorkspaceRepositories } from '#engine/application/engineServices';
import type { SceneFileNameParts, StoryboardProjectPaths, StoryState, StoryUri } from '@storyboard/story-model';
import {
  draftPath,
  extractDraftBody,
  joinStoryPath,
  getStoryboardProjectPaths,
  parseSceneFileName,
  readStoryState,
  storyStateSceneOrders,
} from '@storyboard/story-model';
import type { GenerateDraftWorkflowOptions } from '#engine/application/drafts/draftGenerationContract';
import { loadSceneGenerationInputs, type SceneGenerationInputsResult } from '#engine/application/drafts/sceneGenerationInputs';
import { recordStoryStateFromDraft } from '#engine/application/drafts/updateStoryState';
import type { StoryboardAiService } from '@storyboard/story-ai';
import type { FileSystemDirectoryEntry } from '#engine/ports/fileSystem';

export interface GenerateStoryStateRequest {
  readonly workspaceRoot: StoryUri;
  readonly sceneOrders?: readonly number[];
  readonly force?: boolean;
  readonly shouldPause?: () => boolean;
  readonly onProgress?: (progress: GenerateStoryStateProgress) => void;
}

export interface GenerateStoryStateProgress {
  readonly stem: string;
  readonly current: number;
  readonly total: number;
}

export interface GenerateStoryStateResult {
  readonly recorded: readonly string[];
  readonly kept: readonly string[];
  readonly withoutDraft: readonly string[];
  readonly failures: readonly { readonly stem: string; readonly message: string }[];
  readonly pausedWithRemaining?: number;
}

export interface ScenesWithDrafts {
  readonly targets: readonly { readonly stem: string; readonly order: number; readonly sceneUri: StoryUri }[];
  readonly withoutDraft: readonly string[];
}

export class GenerateStoryStateUseCase {
  public constructor(
    private readonly host: HostAdapters,
    private readonly ai: AiServices,
    private readonly repositories: WorkspaceRepositories,
  ) {}

  public async execute(request: GenerateStoryStateRequest): Promise<GenerateStoryStateResult> {
    const scenes: ScenesWithDrafts = await this.listScenesWithDrafts(request);
    const aiService: StoryboardAiService = this.ai.gateway.createService(request.workspaceRoot);
    const recorded: string[] = [];
    const kept: string[] = [];
    const failures: { stem: string; message: string }[] = [];

    for (const [index, scene] of scenes.targets.entries()) {
      if (request.shouldPause?.()) {
        return {
          recorded,
          kept,
          withoutDraft: scenes.withoutDraft,
          failures,
          pausedWithRemaining: scenes.targets.length - index,
        };
      }

      request.onProgress?.({ stem: scene.stem, current: index + 1, total: scenes.targets.length });

      try {
        const outcome: 'recorded' | 'kept' = await this.recordScene(request, scene, aiService);
        (outcome === 'kept' ? kept : recorded).push(scene.stem);
      } catch (error) {
        this.host.logger.error(`Failed to record the story state of ${scene.stem}`, error);
        failures.push({ stem: scene.stem, message: String(error) });
      }
    }

    return { recorded, kept, withoutDraft: scenes.withoutDraft, failures };
  }

  private async recordScene(
    request: GenerateStoryStateRequest,
    scene: { readonly stem: string; readonly order: number; readonly sceneUri: StoryUri },
    aiService: StoryboardAiService,
  ): Promise<'recorded' | 'kept'> {
    const options: GenerateDraftWorkflowOptions = {
      host: this.host,
      ai: this.ai,
      repositories: this.repositories,
      sceneUri: scene.sceneUri,
      force: true,
      skipSceneGrounding: true,
      skipSceneBeats: true,
      suppressLoggerPanel: true,
    };
    const loaded: SceneGenerationInputsResult = await loadSceneGenerationInputs(scene.sceneUri, options);
    if (!loaded.ok) {
      throw new Error(
        loaded.result.ok === false && loaded.result.kind === 'failed'
          ? loaded.result.message
          : '씬 입력을 읽지 못했습니다.',
      );
    }

    const { inputs } = loaded;
    if (request.force !== true) {
      const state: StoryState = await readStoryState(inputs.threadPaths.storyState, this.host.fileSystem);
      if (
        state.sceneInputHashes.has(scene.order) ||
        storyStateSceneOrders(state).includes(scene.order)
      ) {
        return 'kept';
      }
    }

    const draftText: string = new TextDecoder().decode(
      await this.host.fileSystem.readFile(draftPath(request.workspaceRoot, scene.stem)),
    );
    await recordStoryStateFromDraft(inputs, options, aiService, extractDraftBody(draftText));

    return 'recorded';
  }

  private async listScenesWithDrafts(request: GenerateStoryStateRequest): Promise<ScenesWithDrafts> {
    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(request.workspaceRoot);
    const entries: never[] | FileSystemDirectoryEntry[] = await this.host.fileSystem.readDirectory(paths.sceneDirectory).catch(() => []);
    const requested: readonly number[] | undefined = request.sceneOrders;
    const targets: { stem: string; order: number; sceneUri: StoryUri }[] = [];
    const withoutDraft: string[] = [];

    for (const [fileName, entry] of entries) {
      const parsed: SceneFileNameParts | undefined = entry.type === 'file' ? parseSceneFileName(fileName) : undefined;
      if (parsed === undefined || (requested !== undefined && !requested.includes(parsed.order))) {
        continue;
      }

      const stem: string = fileName.slice(0, -'.card'.length);
      if (!(await this.host.fileSystem.exists(draftPath(request.workspaceRoot, stem)))) {
        withoutDraft.push(stem);
        continue;
      }

      targets.push({ stem, order: parsed.order, sceneUri: joinStoryPath(paths.sceneDirectory, fileName) });
    }

    targets.sort((left, right) => left.order - right.order);
    return { targets, withoutDraft: withoutDraft.sort() };
  }
}
