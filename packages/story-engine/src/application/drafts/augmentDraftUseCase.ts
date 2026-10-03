import type { AiGateway } from '#engine/application/ai/aiGateway';
import type { StoryUri, BibleFact, ProjectFormat, SceneContext } from '@storyboard/story-model';
import type { IStoryboardLogger } from '#engine/ports/logger';
import { failedResult } from '#engine/application/useCase';
import { sceneContextPaths } from '#engine/paths/sceneContextPaths';
import { formatAugmentCards } from '@storyboard/story-ai';
import type { ConfigBridge, DraftAugmentScope } from '@storyboard/story-ai';
import {
  draftHistorySceneDirectory,
  getStoryboardProjectPaths,
  joinUri,
} from '#engine/paths/projectPaths';
import {
  buildNarrativeContext,
  buildSceneContext,
  formatBibleFactLines,
  readSceneFile,
  SceneParseError,
} from '@storyboard/story-model';
import type { IFileSystem } from '#engine/ports/fileSystem';
import { archiveExistingDraft } from '#engine/domain/files/draftHistory';
import { readProjectJson } from '#engine/persistence/projectJson';
type AugmentContextResult =
  | {
      readonly bibleFacts: readonly BibleFact[];
      readonly format: ProjectFormat;
      readonly ok: true;
      readonly sceneContext: SceneContext;
    }
  | { readonly message: string; readonly ok: false };

export type AugmentDraftRequest = {
  readonly draftSceneStem: string;
  readonly instruction?: string;
  readonly sceneUri: StoryUri;
  readonly scope: DraftAugmentScope;
  readonly target: string;
  readonly workspaceRoot: StoryUri;
};

export type AugmentDraftResult =
  | { readonly kind: 'augmented'; readonly ok: true; readonly text: string }
  | { readonly kind: 'empty'; readonly ok: false }
  | { readonly kind: 'failed'; readonly message: string; readonly ok: false };

export type ApplyAugmentedDraftRequest = {
  readonly draftUri: StoryUri;
  readonly sceneStem: string;
  readonly workspaceRoot: StoryUri;
};

export interface AugmentDraftUseCaseDependencies {
  readonly fileSystem: IFileSystem;
  readonly aiGateway: AiGateway;
  readonly logger: IStoryboardLogger;
  readonly configBridge: ConfigBridge;
}

export class AugmentDraftUseCase {
  public constructor(private readonly deps: AugmentDraftUseCaseDependencies) {}

  public async prepareAugmentedDraft(request: AugmentDraftRequest): Promise<AugmentDraftResult> {
    const context = await this.loadContext(request.sceneUri, request.workspaceRoot);

    if (!context.ok) {
      return { kind: 'failed', message: context.message, ok: false };
    }

    try {
      const text = await this.deps.aiGateway.createService(request.workspaceRoot).augmentDraft(
        {
          target: request.target,
          scope: request.scope,
          format: context.format,
          cards: formatAugmentCards(
            context.sceneContext.characters,
            context.sceneContext.background,
          ),
          facts: formatBibleFactLines(context.sceneContext, context.bibleFacts),
          intent: context.sceneContext.scene.body,
          instruction: request.instruction,
        },
        {
          providerId: this.deps.aiGateway.getTaskProvider('draftAugment'),
          attribution: { primary: { kind: 'scene', id: request.draftSceneStem } },
        },
      );

      return text.trim().length === 0
        ? { kind: 'empty', ok: false }
        : { kind: 'augmented', ok: true, text };
    } catch (error) {
      this.deps.logger.error('Augment draft failed', error);
      return failedResult(error);
    }
  }

  public async applyAugmentedDraft(request: ApplyAugmentedDraftRequest): Promise<void> {
    if (!this.deps.configBridge.isKeepDraftHistoryEnabled()) {
      return;
    }

    const historyDirectory = draftHistorySceneDirectory(request.workspaceRoot, request.sceneStem);

    try {
      await archiveExistingDraft({
        draftUri: request.draftUri,
        historyDirectory,
        resolveArchiveUri: (archiveFileName) => joinUri(historyDirectory, archiveFileName),
        fileSystem: this.deps.fileSystem,
      });
    } catch (error) {
      this.deps.logger.warn(`이전 초안을 .draft 히스토리에 보관하지 못했습니다: ${String(error)}`);
    }
  }

  private async loadContext(
    sceneUri: StoryUri,
    workspaceRoot: StoryUri,
  ): Promise<AugmentContextResult> {
    const fileName = sceneUri.path.split('/').pop() ?? '';

    let scene;
    try {
      scene = await readSceneFile(sceneUri, this.deps.fileSystem, fileName);
    } catch (error) {
      return error instanceof SceneParseError
        ? { message: `연결된 씬 파일을 읽을 수 없습니다: ${error.message}`, ok: false }
        : { message: '연결된 씬 파일을 찾을 수 없습니다.', ok: false };
    }

    const paths = getStoryboardProjectPaths(workspaceRoot);
    let project;
    try {
      project = await readProjectJson(this.deps.fileSystem, paths.projectJson);
    } catch {
      return { message: 'project.json을 읽을 수 없습니다.', ok: false };
    }

    const contextPaths = sceneContextPaths(paths);
    let sceneContext;
    try {
      sceneContext = await buildSceneContext(contextPaths, scene, this.deps.fileSystem);
    } catch {
      return { message: '씬 컨텍스트를 구성하지 못했습니다.', ok: false };
    }

    const narrativeContext = await buildNarrativeContext(
      contextPaths,
      sceneContext,
      this.deps.fileSystem,
    );

    return {
      bibleFacts: narrativeContext.bibleFacts,
      format: project.format,
      ok: true,
      sceneContext,
    };
  }
}
