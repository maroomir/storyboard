import type { AiServices, HostAdapters, WorkspaceRepositories } from '#engine/application/engineServices';
import type { SceneFile, StoryState, StoryUri } from '@storyboard/story-model';
import {
  draftPath,
  extractDraftBody,
  readStoryState,
  storyStateSceneOrders,
} from '@storyboard/story-model';
import {
  SceneGenerationInputsLoader,
  type SceneGenerationInputsRequest,
  type SceneGenerationInputsResult,
} from '#engine/application/drafts/sceneGenerationInputs';
import { StoryStateRecorder } from '#engine/application/drafts/updateStoryState';
import type { StoryboardAiService } from '@storyboard/story-ai';

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

const recordedSceneInputsRequest: SceneGenerationInputsRequest = {
  skipSceneBeats: true,
  suppressLoggerPanel: true,
};

export class GenerateStoryStateUseCase {
  private readonly inputsLoader: SceneGenerationInputsLoader;
  private readonly storyStateRecorder: StoryStateRecorder;

  public constructor(
    private readonly host: HostAdapters,
    private readonly ai: AiServices,
    repositories: WorkspaceRepositories,
  ) {
    this.inputsLoader = new SceneGenerationInputsLoader({ host, ai, repositories });
    this.storyStateRecorder = new StoryStateRecorder({ host, ai });
  }

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
    const loaded: SceneGenerationInputsResult = await this.inputsLoader.load(
      scene.sceneUri,
      recordedSceneInputsRequest,
    );
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
    await this.storyStateRecorder.recordFromDraft(inputs, aiService, extractDraftBody(draftText));

    return 'recorded';
  }

  private async listScenesWithDrafts(request: GenerateStoryStateRequest): Promise<ScenesWithDrafts> {
    const requested: readonly number[] | undefined = request.sceneOrders;
    const targets: { stem: string; order: number; sceneUri: StoryUri }[] = [];
    const withoutDraft: string[] = [];
    const scenes: readonly SceneFile[] = (await this.host.scenes.loadRoster(request.workspaceRoot)).scenes;

    for (const scene of scenes) {
      if (requested !== undefined && !requested.includes(scene.order)) {
        continue;
      }

      if (!(await this.host.fileSystem.exists(draftPath(request.workspaceRoot, scene.stem)))) {
        withoutDraft.push(scene.stem);
        continue;
      }

      targets.push({
        stem: scene.stem,
        order: scene.order,
        sceneUri: this.host.scenes.sceneUri(request.workspaceRoot, scene.stem),
      });
    }

    return { targets, withoutDraft: withoutDraft.sort() };
  }
}
