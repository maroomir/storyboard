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

import {
  SceneNarrationResolver,
  type ChapterNarrationDefaults,
  type SceneThreadContext,
} from '#engine/application/drafts/sceneNarrationResolver';
import { sceneCacheFilePath } from '#engine/persistence/sceneCacheWorkspace';
import { resolveSceneBreakJoiner } from '#engine/pipeline/sceneGenerationPolicies';
import type { GenerateDraftResult, GenerateDraftWorkflowOptions } from '#engine/application/drafts/draftGenerationContract';
import { resolveSceneBeats } from '#engine/application/drafts/resolveSceneBeats';
import { resolveSceneGrounding, type SceneGroundingOutcome } from '#engine/application/drafts/resolveSceneGrounding';
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

type SceneGenerationTargetResult =
  | { readonly ok: false; readonly result: GenerateDraftResult }
  | {
      readonly ok: true;
      readonly workspaceFolder: StoryWorkspaceFolder;
      readonly paths: ReturnType<typeof getStoryboardProjectPaths>;
      readonly fileName: string;
    };

export function reportWorkflowFailure(
  options: GenerateDraftWorkflowOptions,
  logMessage: string,
  error: unknown,
  userMessage: string,
): GenerateDraftResult {
  options.host.logger.error(logMessage, error);

  if (!options.suppressLoggerPanel) {
    options.host.logger.show();
  }

  return { ok: false, kind: 'failed', message: userMessage };
}

interface InputsFailure {
  ok: false;
  result: GenerateDraftResult;
}

function inputsFailure(message: string): InputsFailure {
  return { ok: false, result: { ok: false, kind: 'failed', message } };
}

async function resolveSceneGenerationTarget(
  sceneUri: StoryUri,
  options: GenerateDraftWorkflowOptions,
): Promise<SceneGenerationTargetResult> {
  const workspaceFolder: StoryWorkspaceFolder | undefined =
    options.host.workspaceLocator.folderFor(sceneUri);

  if (!workspaceFolder) {
    return inputsFailure('씬 파일이 속한 워크스페이스 폴더를 찾을 수 없습니다.');
  }

  if (
    !(await hasStoryboardProjectAt(workspaceFolder.uri, (uri) =>
      options.host.fileSystem.exists(uri),
    ))
  ) {
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

type SceneAndProjectResult =
  | { readonly ok: false; readonly result: GenerateDraftResult }
  | {
      readonly ok: true;
      readonly scene: Awaited<ReturnType<ISceneRepository['read']>>;
      readonly project: Awaited<ReturnType<IProjectRepository['read']>>;
    };

async function loadSceneAndProject(
  sceneUri: StoryUri,
  fileName: string,
  paths: ReturnType<typeof getStoryboardProjectPaths>,
  options: GenerateDraftWorkflowOptions,
): Promise<SceneAndProjectResult> {
  let scene: SceneFile;
  try {
    scene = await options.repositories.scenes.read(sceneUri, fileName);
  } catch (error) {
    if (error instanceof SceneParseError) {
      return inputsFailure(`씬 파일을 읽을 수 없습니다: ${error.message}`);
    }

    return {
      ok: false,
      result: reportWorkflowFailure(
        options,
        'Failed to read scene file',
        error,
        '씬 파일을 읽는 중 오류가 발생했습니다. Output 패널을 확인해 주세요.',
      ),
    };
  }

  let project: StoryboardProject;
  try {
    project = await options.repositories.project.read(paths.projectJson);
  } catch (error) {
    return {
      ok: false,
      result: reportWorkflowFailure(
        options,
        'Failed to read project.json',
        error,
        'project.json을 읽을 수 없습니다. Output 패널을 확인해 주세요.',
      ),
    };
  }

  return { ok: true, scene, project };
}

export async function loadSceneGenerationInputs(
  sceneUri: StoryUri,
  options: GenerateDraftWorkflowOptions,
): Promise<SceneGenerationInputsResult> {
  const target: SceneGenerationTargetResult = await resolveSceneGenerationTarget(sceneUri, options);
  if (!target.ok) {
    return target;
  }

  const { workspaceFolder, paths, fileName } = target;

  const loaded: SceneAndProjectResult = await loadSceneAndProject(
    sceneUri,
    fileName,
    paths,
    options,
  );
  if (!loaded.ok) {
    return loaded;
  }

  const { project } = loaded;

  const contextResult: SceneContextBundleResult = await loadSceneContextBundle(
    paths,
    sceneUri,
    loaded.scene,
    project,
    options,
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

async function loadSceneContextBundle(
  paths: ProjectPaths,
  sceneUri: StoryUri,
  rawScene: Awaited<ReturnType<ISceneRepository['read']>>,
  project: GenerationProject,
  options: GenerateDraftWorkflowOptions,
): Promise<SceneContextBundleResult> {
  const built: BaseSceneContextResult = await buildBaseSceneContext(paths, rawScene, options);
  if (!built.ok) {
    return built;
  }

  const scene: SceneFile | undefined = await resolveGeneratedScene(
    paths,
    sceneUri,
    rawScene,
    built.context,
    options,
  );
  if (scene === undefined) {
    return { ok: false, result: { ok: false, kind: 'cancelled' } };
  }
  const context: SceneContext = { ...built.context, scene };

  const setup: SceneThreadSetup = await resolveSceneThreadSetup(paths, scene, project, options);
  const narrativeContext: NarrativeContext = await loadSceneNarrative(
    setup.thread,
    setup.narration,
    context,
    options,
  );

  return assembleSceneContextBundle(scene, context, project, setup, narrativeContext);
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

async function buildBaseSceneContext(
  paths: ProjectPaths,
  rawScene: Awaited<ReturnType<ISceneRepository['read']>>,
  options: GenerateDraftWorkflowOptions,
): Promise<BaseSceneContextResult> {
  const ctxPaths: SceneContextWorkspacePaths = sceneContextPaths(paths);

  try {
    const context: SceneContext = await new SceneContextReader(options.host.fileSystem).build(
      ctxPaths,
      rawScene,
    );
    return { ok: true, context };
  } catch (error) {
    return {
      ok: false,
      result: reportWorkflowFailure(
        options,
        'Failed to build scene context',
        error,
        '씬 컨텍스트를 구성하지 못했습니다. Output 패널을 확인해 주세요.',
      ),
    };
  }
}

async function resolveGeneratedScene(
  paths: ProjectPaths,
  sceneUri: StoryUri,
  rawScene: Awaited<ReturnType<ISceneRepository['read']>>,
  builtContext: SceneContext,
  options: GenerateDraftWorkflowOptions,
): Promise<SceneFile | undefined> {
  const characterNames: string[] = builtContext.characters.map((character) => character.name);
  const grounded: SceneGroundingOutcome = await resolveSceneGrounding(
    paths.workspaceRoot,
    sceneUri,
    rawScene,
    characterNames,
    options,
  );
  if (grounded.kind === 'cancelled') {
    return undefined;
  }

  return options.skipSceneBeats
    ? grounded.scene
    : await resolveSceneBeats(sceneUri, grounded.scene, builtContext.characters, options);
}

async function resolveSceneThreadSetup(
  paths: ProjectPaths,
  scene: SceneFile,
  project: GenerationProject,
  options: GenerateDraftWorkflowOptions,
): Promise<SceneThreadSetup> {
  const narrationResolver: SceneNarrationResolver = new SceneNarrationResolver(
    options.host.fileSystem,
  );
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
    options.host.configBridge.getDraftSceneBreakSeparator(),
  );
  const staleWarnings: readonly (string | undefined)[] = await auditThreadMemory(
    thread.threadPaths,
    project,
    sceneBreakJoiner,
    scene.order,
    options,
  );

  return { thread, narration, sceneBreakJoiner, staleWarnings };
}

async function auditThreadMemory(
  threadPaths: ProjectPaths,
  project: GenerationProject,
  sceneBreakJoiner: string | undefined,
  beforeSceneOrder: number,
  options: GenerateDraftWorkflowOptions,
): Promise<readonly (string | undefined)[]> {
  const memoryAuditor: StoryMemoryAuditor = new StoryMemoryAuditor({
    fileSystem: options.host.fileSystem,
    paths: threadPaths,
    format: project.format,
    sceneBreakJoiner,
    beforeSceneOrder,
  });
  const memoryAudit: StoryMemoryAudit = await memoryAuditor.audit();
  await memoryAuditor.markStale(memoryAudit);

  const chapterAuditor: ChapterMemoryAuditor = new ChapterMemoryAuditor({
    fileSystem: options.host.fileSystem,
    paths: threadPaths,
  });
  const chapterAudit: ChapterMemoryAudit = await chapterAuditor.audit();
  await chapterAuditor.markStale(chapterAudit);

  return [memoryAudit.staleWarning, chapterAudit.staleWarning];
}

async function loadSceneNarrative(
  thread: SceneThreadContext,
  narration: NarrationDirective | undefined,
  context: SceneContext,
  options: GenerateDraftWorkflowOptions,
): Promise<NarrativeContext> {
  return await new SceneContextReader(options.host.fileSystem).buildNarrative(
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
