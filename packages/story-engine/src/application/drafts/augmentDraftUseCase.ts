import { SceneContextReader } from '#engine/persistence/sceneContextReader';
import { ProjectRepository } from '#engine/persistence/repositories/projectRepository';
import type { AiServices, HostAdapters } from '#engine/application/engineServices';
import type {
  StoryUri,
  BibleFact,
  ProjectFormat,
  SceneContext,
  StoryboardProjectPaths,
  SceneContextWorkspacePaths,
  NarrativeContext,
  SceneFile,
  StoryboardProject,
} from '@storyboard/story-model';
import { failedResult } from '#engine/application/useCase';
import {
  sceneContextPaths,
  draftHistorySceneDirectory,
  getStoryboardProjectPaths,
  joinUri,
  formatBibleFactLines,
  readSceneFile,
  SceneParseError,
  archiveExistingDraft,
} from '@storyboard/story-model';
import { formatAugmentCards } from '@storyboard/story-ai';
import type { DraftAugmentScope } from '@storyboard/story-ai';
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

export class AugmentDraftUseCase {
  public constructor(
    private readonly host: HostAdapters,
    private readonly ai: AiServices,
  ) {}

  public async prepareAugmentedDraft(request: AugmentDraftRequest): Promise<AugmentDraftResult> {
    const context: AugmentContextResult = await this.loadContext(
      request.sceneUri,
      request.workspaceRoot,
    );

    if (!context.ok) {
      return { kind: 'failed', message: context.message, ok: false };
    }

    try {
      const text: string = await this.ai.gateway.createService(request.workspaceRoot).augmentDraft(
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
          providerId: this.ai.gateway.getTaskProvider('draftAugment'),
          attribution: { primary: { kind: 'scene', id: request.draftSceneStem } },
        },
      );

      return text.trim().length === 0
        ? { kind: 'empty', ok: false }
        : { kind: 'augmented', ok: true, text };
    } catch (error) {
      this.host.logger.error('Augment draft failed', error);
      return failedResult(error);
    }
  }

  public async applyAugmentedDraft(request: ApplyAugmentedDraftRequest): Promise<void> {
    if (!this.host.configBridge.isKeepDraftHistoryEnabled()) {
      return;
    }

    const historyDirectory: StoryUri = draftHistorySceneDirectory(
      request.workspaceRoot,
      request.sceneStem,
    );

    try {
      await archiveExistingDraft({
        draftUri: request.draftUri,
        historyDirectory,
        resolveArchiveUri: (archiveFileName) => joinUri(historyDirectory, archiveFileName),
        fileSystem: this.host.fileSystem,
      });
    } catch (error) {
      this.host.logger.warn(`이전 초안을 .draft 히스토리에 보관하지 못했습니다: ${String(error)}`);
    }
  }

  private async loadContext(
    sceneUri: StoryUri,
    workspaceRoot: StoryUri,
  ): Promise<AugmentContextResult> {
    const fileName: string = sceneUri.path.split('/').pop() ?? '';

    let scene: SceneFile;
    try {
      scene = await readSceneFile(sceneUri, this.host.fileSystem, fileName);
    } catch (error) {
      return error instanceof SceneParseError
        ? { message: `연결된 씬 파일을 읽을 수 없습니다: ${error.message}`, ok: false }
        : { message: '연결된 씬 파일을 찾을 수 없습니다.', ok: false };
    }

    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceRoot);
    let project: StoryboardProject;
    try {
      project = await new ProjectRepository(this.host.fileSystem).read(paths.projectJson);
    } catch {
      return { message: 'project.json을 읽을 수 없습니다.', ok: false };
    }

    const contextPaths: SceneContextWorkspacePaths = sceneContextPaths(paths);
    let sceneContext: SceneContext;
    try {
      sceneContext = await new SceneContextReader(this.host.fileSystem).build(contextPaths, scene);
    } catch {
      return { message: '씬 컨텍스트를 구성하지 못했습니다.', ok: false };
    }

    const narrativeContext: NarrativeContext = await new SceneContextReader(
      this.host.fileSystem,
    ).buildNarrative(contextPaths, sceneContext);

    return {
      bibleFacts: narrativeContext.bibleFacts,
      format: project.format,
      ok: true,
      sceneContext,
    };
  }
}
