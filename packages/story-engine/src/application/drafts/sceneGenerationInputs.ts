import {
  hasStoryboardProjectAt,
  sceneContextPaths,
  buildNarrativeContext,
  buildSceneContext,
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
  readChapterNarrationDefaults,
  resolveSceneNarration,
  type ChapterNarrationDefaults,
} from './resolveSceneNarration';
import { resolveSceneThread, type SceneThreadContext } from './resolveSceneThread';
import { sceneCacheFilePath } from '#engine/persistence/sceneCacheWorkspace';
import { resolveSceneBreakJoiner } from '#engine/pipeline/sceneGenerationPolicies';
import type { GenerateDraftResult, GenerateDraftWorkflowOptions } from './generateDraftTypes';
import { resolveSceneBeats } from './resolveSceneBeats';
import { resolveSceneGrounding, type SceneGroundingOutcome } from './resolveSceneGrounding';
import {
  auditStoryMemory,
  markStoryStateStaleEntries,
  type StoryMemoryAudit,
} from './storyStateAudit';
import {
  auditChapterMemory,
  markStaleChapterSummaries,
  type ChapterMemoryAudit,
  type ChapterSummaryAuditRequest,
} from '#engine/application/manuscript/chapterSummaryAudit';

export interface SceneGenerationInputs {
  readonly workspaceFolder: StoryWorkspaceFolder;
  readonly paths: ReturnType<typeof getStoryboardProjectPaths>;
  readonly threadPaths: ReturnType<typeof getStoryboardProjectPaths>;
  readonly threadId: string;
  readonly narration: NarrationDirective | undefined;
  readonly scene: Awaited<ReturnType<ISceneRepository['read']>>;
  readonly project: Awaited<ReturnType<IProjectRepository['read']>>;
  readonly context: Awaited<ReturnType<typeof buildSceneContext>>;
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
      readonly context: Awaited<ReturnType<typeof buildSceneContext>>;
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

async function loadSceneContextBundle(
  paths: ReturnType<typeof getStoryboardProjectPaths>,
  sceneUri: StoryUri,
  rawScene: Awaited<ReturnType<ISceneRepository['read']>>,
  project: Awaited<ReturnType<IProjectRepository['read']>>,
  options: GenerateDraftWorkflowOptions,
): Promise<SceneContextBundleResult> {
  const ctxPaths: SceneContextWorkspacePaths = sceneContextPaths(paths);
  let builtContext: SceneContext;
  try {
    builtContext = await buildSceneContext(ctxPaths, rawScene, options.host.fileSystem);
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

  const characterNames: string[] = builtContext.characters.map((character) => character.name);
  const grounded: SceneGroundingOutcome = await resolveSceneGrounding(
    paths.workspaceRoot,
    sceneUri,
    rawScene,
    characterNames,
    options,
  );
  if (grounded.kind === 'cancelled') {
    return { ok: false, result: { ok: false, kind: 'cancelled' } };
  }

  const scene: SceneFile = options.skipSceneBeats
    ? grounded.scene
    : await resolveSceneBeats(sceneUri, grounded.scene, builtContext.characters, options);
  const context: SceneContext = { ...builtContext, scene };

  const chapterDefaults: ChapterNarrationDefaults = await readChapterNarrationDefaults(
    paths,
    scene.order,
    options.host.fileSystem,
  );
  const thread: SceneThreadContext = await resolveSceneThread(
    paths,
    scene,
    project,
    options.host.fileSystem,
    chapterDefaults.thread,
  );
  const narration: NarrationDirective | undefined = await resolveSceneNarration(
    paths,
    scene,
    project,
    chapterDefaults,
    options.host.fileSystem,
  );
  const sceneBreakJoiner: string | undefined = resolveSceneBreakJoiner(
    options.host.configBridge.getDraftSceneBreakSeparator(),
  );

  const memoryAudit: StoryMemoryAudit = await auditStoryMemory({
    fileSystem: options.host.fileSystem,
    paths: thread.threadPaths,
    format: project.format,
    sceneBreakJoiner,
    beforeSceneOrder: scene.order,
  });
  await markStoryStateStaleEntries(thread.threadPaths, options.host.fileSystem, memoryAudit);

  const chapterAuditRequest: ChapterSummaryAuditRequest = {
    fileSystem: options.host.fileSystem,
    paths: thread.threadPaths,
  };
  const chapterAudit: ChapterMemoryAudit = await auditChapterMemory(chapterAuditRequest);
  await markStaleChapterSummaries(chapterAuditRequest, chapterAudit);

  const narrativeContext: NarrativeContext = await buildNarrativeContext(
    sceneContextPaths(thread.threadPaths),
    context,
    options.host.fileSystem,
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
  const inputHash: string = computeSceneInputHash({
    sceneBody: context.scene.body,
    characters: context.characters,
    background: context.background,
    format: project.format,
    bibleFacts: narrativeContext.bibleFacts,
    sceneBreakJoiner,
    grounding: scene.frontmatter.grounding,
    narration: sceneNarrationHashInput(scene),
  });

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
    warnings: [
      memoryAudit.staleWarning,
      chapterAudit.staleWarning,
      ...findUnknownBeatCast(scene.card?.beats, context.characters).map(
        ({ beat, ref }) =>
          `비트 ${beat}의 출연 «${ref}»이(가) 이 씬의 인물 카드와 맞지 않아 그대로 프롬프트에 실렸습니다`,
      ),
    ].filter((warning): warning is string => warning !== undefined),
    threadPaths: thread.threadPaths,
    threadId: thread.threadId,
    narration,
  };
}
