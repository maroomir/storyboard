import { SceneContextReader } from '#engine/persistence/sceneContextReader';
import {
  hasStoryboardProjectAt,
  sceneContextPaths,
  formatBibleFactLines,
  parseSceneFileName,
  SceneParseError,
  type NarrationDirective,
  draftPath,
  getStoryboardProjectPaths,
  isDirectSceneCardFile,
  computeSceneInputHash,
  sceneNarrationHashInput,
  findUnknownBeatCast,
} from '@storyboard/story-model';
import type {
  NarrativeContext,
  SceneContext,
  SceneContextWorkspacePaths,
  SceneFile,
  StoryboardProject,
  StoryUri,
  StoryWorkspaceFolder,
} from '@storyboard/story-model';
import type {
  IProjectRepository,
  ISceneRepository,
} from '#engine/application/drafts/draftRepositories';
import type {
  AiServices,
  HostAdapters,
  WorkspaceRepositories,
} from '#engine/application/engineServices';
import type { IStoryboardLogger } from '#engine/ports/logger';

import {
  SceneNarrationResolver,
  type ChapterNarrationDefaults,
  type SceneThreadContext,
} from '#engine/application/drafts/sceneNarrationResolver';
import { sceneCacheFilePath } from '#engine/persistence/sceneCacheWorkspace';
import { resolveSceneBreakJoiner } from '#engine/pipeline/sceneGenerationPolicies';
import type { GenerateDraftRequest, GenerateDraftResult } from '#engine/application/drafts/draftGenerationContract';
import { SceneBeatsResolver } from '#engine/application/drafts/resolveSceneBeats';
import { SceneGroundingResolver, type SceneGroundingOutcome } from '#engine/application/drafts/resolveSceneGrounding';
import { StoryMemoryAuditor, type StoryMemoryAudit } from '#engine/application/drafts/storyMemoryAuditor';
import {
  ChapterMemoryAuditor,
  type ChapterMemoryAudit,
} from '#engine/application/manuscript/chapterMemoryAuditor';

export interface SceneGenerationInputs {
  readonly workspaceFolder: StoryWorkspaceFolder;
  readonly paths: ReturnType<typeof getStoryboardProjectPaths>;
  readonly threadPaths: ReturnType<typeof getStoryboardProjectPaths>;
  readonly threadId: string;
  readonly narration: NarrationDirective | undefined;
  readonly scene: Awaited<ReturnType<ISceneRepository['read']>>;
  readonly project: Awaited<ReturnType<IProjectRepository['read']>>;
  readonly context: SceneContext;
  readonly previousContext: string | undefined;
  readonly canonFactLines: readonly string[];
  readonly characterKnowledge: ReadonlyMap<string, readonly string[]> | undefined;
  readonly characterRelations: ReadonlyMap<string, readonly string[]> | undefined;
  readonly sceneBreakJoiner: string | undefined;
  readonly inputHash: string;
  readonly warnings: readonly string[];
  readonly draftUri: StoryUri;
  readonly cacheUri: StoryUri;
}

export type SceneGenerationInputsResult =
  | { readonly ok: false; readonly result: GenerateDraftResult }
  | { readonly ok: true; readonly inputs: SceneGenerationInputs };

export type WorkflowFailureRequest = Pick<GenerateDraftRequest, 'suppressLoggerPanel'>;

export type SceneGenerationInputsRequest = Pick<
  GenerateDraftRequest,
  'skipSceneGrounding' | 'confirmSceneGrounding' | 'skipSceneBeats' | 'suppressLoggerPanel'
>;

export interface SceneGenerationInputsLoaderDependencies {
  readonly host: HostAdapters;
  readonly ai: AiServices;
  readonly repositories: WorkspaceRepositories;
}

type SceneGenerationTargetResult =
  | { readonly ok: false; readonly result: GenerateDraftResult }
  | {
      readonly ok: true;
      readonly workspaceFolder: StoryWorkspaceFolder;
      readonly paths: ReturnType<typeof getStoryboardProjectPaths>;
      readonly fileName: string;
    };

export class WorkflowFailureReporter {
  public constructor(private readonly logger: IStoryboardLogger) {}

  public report(
    request: WorkflowFailureRequest,
    logMessage: string,
    error: unknown,
    userMessage: string,
  ): GenerateDraftResult {
    this.logger.error(logMessage, error);

    if (!request.suppressLoggerPanel) {
      this.logger.show();
    }

    return { ok: false, kind: 'failed', message: userMessage };
  }
}

interface InputsFailure {
  ok: false;
  result: GenerateDraftResult;
}

function inputsFailure(message: string): InputsFailure {
  return { ok: false, result: { ok: false, kind: 'failed', message } };
}

type SceneAndProjectResult =
  | { readonly ok: false; readonly result: GenerateDraftResult }
  | {
      readonly ok: true;
      readonly scene: Awaited<ReturnType<ISceneRepository['read']>>;
      readonly project: Awaited<ReturnType<IProjectRepository['read']>>;
    };

type SceneContextBundleResult =
  | { readonly ok: false; readonly result: GenerateDraftResult }
  | {
      readonly ok: true;
      readonly scene: Awaited<ReturnType<ISceneRepository['read']>>;
      readonly context: SceneContext;
      readonly previousContext: string | undefined;
      readonly canonFactLines: readonly string[];
      readonly characterKnowledge: ReadonlyMap<string, readonly string[]> | undefined;
      readonly characterRelations: ReadonlyMap<string, readonly string[]> | undefined;
      readonly sceneBreakJoiner: string | undefined;
      readonly inputHash: string;
      readonly warnings: readonly string[];
      readonly threadPaths: ReturnType<typeof getStoryboardProjectPaths>;
      readonly threadId: string;
      readonly narration: NarrationDirective | undefined;
    };

type ProjectPaths = ReturnType<typeof getStoryboardProjectPaths>;
type GenerationProject = Awaited<ReturnType<IProjectRepository['read']>>;

type BaseSceneContextResult = InputsFailure | { readonly ok: true; readonly context: SceneContext };

interface SceneThreadSetup {
  readonly thread: SceneThreadContext;
  readonly narration: NarrationDirective | undefined;
  readonly sceneBreakJoiner: string | undefined;
  readonly staleWarnings: readonly (string | undefined)[];
}

export class SceneGenerationInputsLoader {
  private readonly groundingResolver: SceneGroundingResolver;
  private readonly beatsResolver: SceneBeatsResolver;
  private readonly failureReporter: WorkflowFailureReporter;

  public constructor(private readonly dependencies: SceneGenerationInputsLoaderDependencies) {
    this.groundingResolver = new SceneGroundingResolver(dependencies);
    this.beatsResolver = new SceneBeatsResolver(dependencies);
    this.failureReporter = new WorkflowFailureReporter(dependencies.host.logger);
  }

  public async load(
    sceneUri: StoryUri,
    request: SceneGenerationInputsRequest,
  ): Promise<SceneGenerationInputsResult> {
    const target: SceneGenerationTargetResult = await this.resolveSceneGenerationTarget(sceneUri);
    if (!target.ok) {
      return target;
    }

    const { workspaceFolder, paths, fileName } = target;

    const loaded: SceneAndProjectResult = await this.loadSceneAndProject(
      sceneUri,
      fileName,
      paths,
      request,
    );
    if (!loaded.ok) {
      return loaded;
    }

    const { project } = loaded;

    const contextResult: SceneContextBundleResult = await this.loadSceneContextBundle(
      paths,
      sceneUri,
      loaded.scene,
      project,
      request,
    );
    if (!contextResult.ok) {
      return contextResult;
    }

    const { scene, context, previousContext, sceneBreakJoiner, inputHash } = contextResult;

    return {
      ok: true,
      inputs: {
        workspaceFolder,
        paths,
        threadPaths: contextResult.threadPaths,
        threadId: contextResult.threadId,
        narration: contextResult.narration,
        scene,
        project,
        context,
        previousContext,
        characterKnowledge: contextResult.characterKnowledge,
        characterRelations: contextResult.characterRelations,
        canonFactLines: contextResult.canonFactLines,
        sceneBreakJoiner,
        inputHash,
        warnings: contextResult.warnings,
        draftUri: draftPath(workspaceFolder.uri, scene.stem),
        cacheUri: sceneCacheFilePath(paths, scene.stem),
      },
    };
  }

  private async resolveSceneGenerationTarget(
    sceneUri: StoryUri,
  ): Promise<SceneGenerationTargetResult> {
    const { host } = this.dependencies;
    const workspaceFolder: StoryWorkspaceFolder | undefined =
      host.workspaceLocator.folderFor(sceneUri);

    if (!workspaceFolder) {
      return inputsFailure('씬 파일이 속한 워크스페이스 폴더를 찾을 수 없습니다.');
    }

    if (!(await hasStoryboardProjectAt(workspaceFolder.uri, (uri) => host.fileSystem.exists(uri)))) {
      return inputsFailure(
        'Storyboard 프로젝트(.storyboard/project.json)가 없습니다. 먼저 초기화해 주세요.',
      );
    }

    if (!isDirectSceneCardFile(sceneUri, workspaceFolder)) {
      return inputsFailure(
        'Storyboard 씬 파일만 처리할 수 있습니다. `scene/NN-slug.card` 형식의 파일을 선택하거나 해당 파일을 편집기에서 연 뒤 다시 시도해 주세요.',
      );
    }

    const fileName: string = sceneUri.path.split('/').pop() ?? '';

    if (!parseSceneFileName(fileName)) {
      return inputsFailure('씬 파일명은 `NN-slug.card` 형식이어야 합니다.');
    }

    return {
      ok: true,
      workspaceFolder,
      paths: getStoryboardProjectPaths(workspaceFolder.uri),
      fileName,
    };
  }

  private async loadSceneAndProject(
    sceneUri: StoryUri,
    fileName: string,
    paths: ReturnType<typeof getStoryboardProjectPaths>,
    request: WorkflowFailureRequest,
  ): Promise<SceneAndProjectResult> {
    let scene: SceneFile;
    try {
      scene = await this.dependencies.repositories.scenes.read(sceneUri, fileName);
    } catch (error) {
      if (error instanceof SceneParseError) {
        return inputsFailure(`씬 파일을 읽을 수 없습니다: ${error.message}`);
      }

      return {
        ok: false,
        result: this.failureReporter.report(
          request,
          'Failed to read scene file',
          error,
          '씬 파일을 읽는 중 오류가 발생했습니다. Output 패널을 확인해 주세요.',
        ),
      };
    }

    let project: StoryboardProject;
    try {
      project = await this.dependencies.repositories.project.read(paths.projectJson);
    } catch (error) {
      return {
        ok: false,
        result: this.failureReporter.report(
          request,
          'Failed to read project.json',
          error,
          'project.json을 읽을 수 없습니다. Output 패널을 확인해 주세요.',
        ),
      };
    }

    return { ok: true, scene, project };
  }

  private async loadSceneContextBundle(
    paths: ProjectPaths,
    sceneUri: StoryUri,
    rawScene: Awaited<ReturnType<ISceneRepository['read']>>,
    project: GenerationProject,
    request: SceneGenerationInputsRequest,
  ): Promise<SceneContextBundleResult> {
    const built: BaseSceneContextResult = await this.buildBaseSceneContext(paths, rawScene, request);
    if (!built.ok) {
      return built;
    }

    const scene: SceneFile | undefined = await this.resolveGeneratedScene(
      paths,
      sceneUri,
      rawScene,
      built.context,
      request,
    );
    if (scene === undefined) {
      return { ok: false, result: { ok: false, kind: 'cancelled' } };
    }
    const context: SceneContext = { ...built.context, scene };

    const setup: SceneThreadSetup = await this.resolveSceneThreadSetup(paths, scene, project);
    const narrativeContext: NarrativeContext = await this.loadSceneNarrative(
      setup.thread,
      setup.narration,
      context,
    );

    return assembleSceneContextBundle(scene, context, project, setup, narrativeContext);
  }

  private async buildBaseSceneContext(
    paths: ProjectPaths,
    rawScene: Awaited<ReturnType<ISceneRepository['read']>>,
    request: WorkflowFailureRequest,
  ): Promise<BaseSceneContextResult> {
    const ctxPaths: SceneContextWorkspacePaths = sceneContextPaths(paths);

    try {
      const context: SceneContext = await new SceneContextReader(
        this.dependencies.host.fileSystem,
      ).build(ctxPaths, rawScene);
      return { ok: true, context };
    } catch (error) {
      return {
        ok: false,
        result: this.failureReporter.report(
          request,
          'Failed to build scene context',
          error,
          '씬 컨텍스트를 구성하지 못했습니다. Output 패널을 확인해 주세요.',
        ),
      };
    }
  }

  private async resolveGeneratedScene(
    paths: ProjectPaths,
    sceneUri: StoryUri,
    rawScene: Awaited<ReturnType<ISceneRepository['read']>>,
    builtContext: SceneContext,
    request: SceneGenerationInputsRequest,
  ): Promise<SceneFile | undefined> {
    const characterNames: string[] = builtContext.characters.map((character) => character.name);
    const grounded: SceneGroundingOutcome = await this.groundingResolver.resolve(
      { workspaceRoot: paths.workspaceRoot, sceneUri, scene: rawScene, characterNames },
      request,
    );
    if (grounded.kind === 'cancelled') {
      return undefined;
    }

    return request.skipSceneBeats
      ? grounded.scene
      : await this.beatsResolver.resolve(sceneUri, grounded.scene, builtContext.characters);
  }

  private async resolveSceneThreadSetup(
    paths: ProjectPaths,
    scene: SceneFile,
    project: GenerationProject,
  ): Promise<SceneThreadSetup> {
    const { host } = this.dependencies;
    const narrationResolver: SceneNarrationResolver = new SceneNarrationResolver(host.fileSystem);
    const chapterDefaults: ChapterNarrationDefaults = await narrationResolver.readChapterDefaults(
      paths,
      scene.order,
    );
    const thread: SceneThreadContext = await narrationResolver.resolveThread(
      paths,
      scene,
      project,
      chapterDefaults.thread,
    );
    const narration: NarrationDirective | undefined = await narrationResolver.resolveNarration(
      paths,
      scene,
      project,
      chapterDefaults,
    );
    const sceneBreakJoiner: string | undefined = resolveSceneBreakJoiner(
      host.configBridge.getDraftSceneBreakSeparator(),
    );
    const staleWarnings: readonly (string | undefined)[] = await this.auditThreadMemory(
      thread.threadPaths,
      project,
      sceneBreakJoiner,
      scene.order,
    );

    return { thread, narration, sceneBreakJoiner, staleWarnings };
  }

  private async auditThreadMemory(
    threadPaths: ProjectPaths,
    project: GenerationProject,
    sceneBreakJoiner: string | undefined,
    beforeSceneOrder: number,
  ): Promise<readonly (string | undefined)[]> {
    const { fileSystem } = this.dependencies.host;
    const memoryAuditor: StoryMemoryAuditor = new StoryMemoryAuditor({
      fileSystem,
      paths: threadPaths,
      format: project.format,
      sceneBreakJoiner,
      beforeSceneOrder,
    });
    const memoryAudit: StoryMemoryAudit = await memoryAuditor.audit();
    await memoryAuditor.markStale(memoryAudit);

    const chapterAuditor: ChapterMemoryAuditor = new ChapterMemoryAuditor({
      fileSystem,
      paths: threadPaths,
    });
    const chapterAudit: ChapterMemoryAudit = await chapterAuditor.audit();
    await chapterAuditor.markStale(chapterAudit);

    return [memoryAudit.staleWarning, chapterAudit.staleWarning];
  }

  private async loadSceneNarrative(
    thread: SceneThreadContext,
    narration: NarrationDirective | undefined,
    context: SceneContext,
  ): Promise<NarrativeContext> {
    return await new SceneContextReader(this.dependencies.host.fileSystem).buildNarrative(
      sceneContextPaths(thread.threadPaths),
      context,
      {
        previousSceneOrder: thread.previousSceneOrder,
        focalFilter: {
          ...(narration?.knowledge === 'witnessed' && narration.focal
            ? { focal: narration.focal }
            : {}),
          ...(narration?.knowledge === 'omniscient'
            ? {}
            : { witnessedByAll: context.characters.map((character) => character.id) }),
        },
      },
    );
  }
}

function assembleSceneContextBundle(
  scene: SceneFile,
  context: SceneContext,
  project: GenerationProject,
  setup: SceneThreadSetup,
  narrativeContext: NarrativeContext,
): SceneContextBundleResult {
  const { thread, narration, sceneBreakJoiner, staleWarnings } = setup;
  const inputHash: string = computeBundleInputHash(
    scene,
    context,
    project,
    narrativeContext,
    sceneBreakJoiner,
  );

  return {
    ok: true,
    scene,
    context,
    previousContext: narrativeContext.prompt,
    canonFactLines: formatBibleFactLines(context, narrativeContext.bibleFacts),
    characterKnowledge: narrativeContext.characterKnowledge,
    characterRelations: narrativeContext.characterRelations,
    sceneBreakJoiner,
    inputHash,
    warnings: collectBundleWarnings(staleWarnings, scene, context),
    threadPaths: thread.threadPaths,
    threadId: thread.threadId,
    narration,
  };
}

function computeBundleInputHash(
  scene: SceneFile,
  context: SceneContext,
  project: GenerationProject,
  narrativeContext: NarrativeContext,
  sceneBreakJoiner: string | undefined,
): string {
  return computeSceneInputHash({
    sceneBody: context.scene.body,
    characters: context.characters,
    background: context.background,
    format: project.format,
    bibleFacts: narrativeContext.bibleFacts,
    sceneBreakJoiner,
    grounding: scene.frontmatter.grounding,
    narration: sceneNarrationHashInput(scene),
  });
}

function collectBundleWarnings(
  staleWarnings: readonly (string | undefined)[],
  scene: SceneFile,
  context: SceneContext,
): string[] {
  return [
    ...staleWarnings,
    ...findUnknownBeatCast(scene.card?.beats, context.characters).map(
      ({ beat, ref }) =>
        `비트 ${beat}의 출연 «${ref}»이(가) 이 씬의 인물 카드와 맞지 않아 그대로 프롬프트에 실렸습니다`,
    ),
  ].filter((warning): warning is string => warning !== undefined);
}
