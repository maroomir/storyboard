import { SceneContextReader } from '#engine/persistence/sceneContextReader';
import type {
  AiServices,
  HostAdapters,
  WorkspaceRepositories,
} from '#engine/application/engineServices';
import type {
  SceneContext,
  SceneFile,
  StoryboardProjectPaths,
  StoryUri,
} from '@storyboard/story-model';
import {
  SceneParseError,
  sceneContextPaths,
  getStoryboardProjectPaths,
  type SceneBeat,
} from '@storyboard/story-model';
import { hasSceneBeats, proposeSceneBeats } from './resolveSceneBeats';

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
  public constructor(
    private readonly host: HostAdapters,
    private readonly ai: AiServices,
    private readonly repositories: WorkspaceRepositories,
  ) {}

  public async execute(request: GenerateSceneBeatsRequest): Promise<GenerateSceneBeatsResult> {
    let scene: SceneFile;
    try {
      scene = await this.repositories.scenes.read(request.sceneUri, request.fileName);
    } catch (error) {
      if (error instanceof SceneParseError) {
        return {
          ok: false,
          kind: 'failed',
          message: `씬 파일을 읽을 수 없습니다: ${error.message}`,
        };
      }
      throw error;
    }

    if (hasSceneBeats(scene) && request.force !== true) {
      return { ok: true, kind: 'kept', beats: scene.card.beats ?? [] };
    }

    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(request.workspaceRoot);
    const context: SceneContext = await new SceneContextReader(this.host.fileSystem).build(
      sceneContextPaths(paths),
      scene,
    );

    let beats: SceneBeat[];
    try {
      beats = await proposeSceneBeats(request.sceneUri, scene, context.characters, {
        host: this.host,
        ai: this.ai,
        repositories: this.repositories,
      });
    } catch (error) {
      this.host.logger.error('Failed to propose scene beats', error);
      return {
        ok: false,
        kind: 'failed',
        message: `씬 비트를 전개하지 못했습니다: ${String(error)}`,
      };
    }

    if (beats.length === 0) {
      return { ok: false, kind: 'failed', message: '씬 비트 전개 응답이 비어 있습니다.' };
    }

    if (request.dryRun === true) {
      return { ok: true, kind: 'proposed', beats, written: false };
    }

    await this.repositories.scenes.writeBeats(request.sceneUri, beats);

    return { ok: true, kind: 'proposed', beats, written: true };
  }
}
