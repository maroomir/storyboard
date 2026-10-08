import type { AiGateway } from '#engine/application/ai/aiGateway';
import type { StoryUri } from '@storyboard/story-model';
import {
  buildSceneContext,
  SceneParseError,
  sceneContextPaths,
  getStoryboardProjectPaths,
  sceneBeatTexts,
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
      readonly beats: readonly string[];
      readonly written: boolean;
    }
  | { readonly ok: true; readonly kind: 'kept'; readonly beats: readonly string[] }
  | { readonly ok: false; readonly kind: 'failed'; readonly message: string };

// `draft generate` 가 비트 없는 씬에 자동으로 하는 일을 명시적 verb 로 노출한다. 기존 비트는
// 창작자가 다듬었을 수 있으므로 force 없이는 건드리지 않는다.
export class GenerateSceneBeatsUseCase {
  public constructor(private readonly deps: GenerateSceneBeatsUseCaseDependencies) {}

  public async execute(request: GenerateSceneBeatsRequest): Promise<GenerateSceneBeatsResult> {
    let scene;
    try {
      scene = await this.deps.sceneRepository.read(request.sceneUri, request.fileName);
    } catch (error) {
      if (error instanceof SceneParseError) {
        return { ok: false, kind: 'failed', message: `씬 파일을 읽을 수 없습니다: ${error.message}` };
      }
      throw error;
    }

    if (hasSceneBeats(scene) && request.force !== true) {
      return { ok: true, kind: 'kept', beats: sceneBeatTexts(scene.card.beats) };
    }

    const paths = getStoryboardProjectPaths(request.workspaceRoot);
    const context = await buildSceneContext(sceneContextPaths(paths), scene, this.deps.fileSystem);
    const characterNames = context.characters.map((character) => character.name);

    let beats: string[];
    try {
      beats = await proposeSceneBeats(request.sceneUri, scene, characterNames, this.deps);
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
