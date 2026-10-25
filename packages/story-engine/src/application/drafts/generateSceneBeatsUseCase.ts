import type { AiGateway } from '#engine/application/ai/aiGateway';
import type { SceneContext, SceneFile, StoryboardProjectPaths, StoryUri } from '@storyboard/story-model';
import {
  buildSceneContext,
  SceneParseError,
  sceneContextPaths,
  getStoryboardProjectPaths,
  type SceneBeat,
} from '@storyboard/story-model';
import type { ConfigBridge } from '@storyboard/story-ai';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type { IStoryboardLogger } from '#engine/ports/logger';
import type { ISceneRepository } from '#engine/application/drafts/draftRepositories';
import { hasSceneBeats, proposeSceneBeats } from './resolveSceneBeats';

export interface GenerateSceneBeatsUseCaseDependencies {
  readonly aiGateway: AiGateway;
  readonly configBridge: ConfigBridge;
  readonly fileSystem: IFileSystem;
  readonly logger: IStoryboardLogger;
  readonly sceneRepository: ISceneRepository;
}

export interface GenerateSceneBeatsRequest {
  readonly workspaceRoot: StoryUri;
  readonly sceneUri: StoryUri;
  readonly fileName: string;
  readonly force?: boolean;
  readonly dryRun?: boolean;
}

export type GenerateSceneBeatsResult =
  | {
      readonly ok: true;
      readonly kind: 'proposed';
      readonly beats: readonly SceneBeat[];
      readonly written: boolean;
    }
  | { readonly ok: true; readonly kind: 'kept'; readonly beats: readonly SceneBeat[] }
  | { readonly ok: false; readonly kind: 'failed'; readonly message: string };

export class GenerateSceneBeatsUseCase {
  public constructor(private readonly deps: GenerateSceneBeatsUseCaseDependencies) {}

  public async execute(request: GenerateSceneBeatsRequest): Promise<GenerateSceneBeatsResult> {
    let scene: SceneFile;
    try {
      scene = await this.deps.sceneRepository.read(request.sceneUri, request.fileName);
    } catch (error) {
      if (error instanceof SceneParseError) {
        return { ok: false, kind: 'failed', message: `씬 파일을 읽을 수 없습니다: ${error.message}` };
      }
      throw error;
    }

    if (hasSceneBeats(scene) && request.force !== true) {
      return { ok: true, kind: 'kept', beats: scene.card.beats ?? [] };
    }

    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(request.workspaceRoot);
    const context: SceneContext = await buildSceneContext(sceneContextPaths(paths), scene, this.deps.fileSystem);

    let beats: SceneBeat[];
    try {
      beats = await proposeSceneBeats(request.sceneUri, scene, context.characters, this.deps);
    } catch (error) {
      this.deps.logger.error('Failed to propose scene beats', error);
      return { ok: false, kind: 'failed', message: `씬 비트를 전개하지 못했습니다: ${String(error)}` };
    }

    if (beats.length === 0) {
      return { ok: false, kind: 'failed', message: '씬 비트 전개 응답이 비어 있습니다.' };
    }

    if (request.dryRun === true) {
      return { ok: true, kind: 'proposed', beats, written: false };
    }

    await this.deps.sceneRepository.writeBeats(request.sceneUri, beats);

    return { ok: true, kind: 'proposed', beats, written: true };
  }
}
